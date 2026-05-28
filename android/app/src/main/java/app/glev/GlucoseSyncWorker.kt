package app.glev

import android.content.Context
import android.webkit.CookieManager
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.changes.UpsertionChange
import androidx.health.connect.client.records.BloodGlucoseRecord
import androidx.health.connect.client.request.ChangesTokenRequest
import androidx.work.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.concurrent.TimeUnit

/**
 * WorkManager worker that pulls new blood-glucose samples from Health Connect
 * and POSTs them to the Glev backend — the Android counterpart of the iOS
 * HealthKitGlucoseBackgroundSync class in AppDelegate.swift.
 *
 * Two scheduling modes:
 *   - One-shot: triggered immediately by [GlucoseChangeReceiver] when Health
 *     Connect notifies the app of new blood-glucose data.
 *   - Periodic: 15-minute safety net (WorkManager's minimum interval) that
 *     catches devices where HC change notifications are unreliable.
 *
 * ## Delivery guarantee (at-least-once)
 * The changes token is advanced ONLY after a confirmed 2xx response from the
 * server. A network failure or 5xx returns Result.retry() so WorkManager
 * re-attempts with the old (un-advanced) token — the server deduplicates on
 * (user_id, source_uuid) so re-posting is safe.
 *
 * ## Pagination
 * Health Connect getChanges() is paginated. The worker loops through all pages
 * before posting, collecting every sample in the burst, so no changes are
 * skipped when a CGM device uploads a batch of readings at once.
 *
 * ## Authentication
 * Mirrors the iOS approach: session cookies are read from the Capacitor
 * WebView via [CookieManager] and forwarded in the HTTP request. A 401 means
 * the user is logged out; no retry (credentials won't change) — the foreground
 * sync will catch up after the user logs back in.
 */
class GlucoseSyncWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    companion object {
        /** Tag applied to every work request so they can be cancelled as a group. */
        const val WORK_TAG = "glev_glucose_sync"

        private const val ONE_SHOT_WORK_NAME = "glev_glucose_oneshot"
        private const val PERIODIC_WORK_NAME = "glev_glucose_periodic"

        /** SharedPreferences file used for the changes token. */
        private const val PREFS_NAME = "glev_health_connect"

        /**
         * Key for the persisted Health Connect changes token.
         * Bumped ("_v2", "_v3"…) if the registered data types change, because
         * using the same token after a type change yields undefined results
         * (mirrors iOS anchorDefaultsKey.v1 convention).
         */
        private const val PREFS_KEY_TOKEN = "changes_token_v1"

        /** Same endpoint as iOS — the server normalises units and deduplicates. */
        private const val SYNC_ENDPOINT = "https://glev.app/api/cgm/apple-health/sync"

        /** Keep well inside WorkManager's per-task budget. */
        private const val TIMEOUT_MS = 25_000

        private val ISO_FORMATTER: DateTimeFormatter =
            DateTimeFormatter.ISO_OFFSET_DATE_TIME

        private val NETWORK_CONSTRAINT = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        /**
         * Enqueue a single immediate sync. Called by [GlucoseChangeReceiver]
         * when Health Connect delivers a data-change notification.
         */
        fun scheduleOneShot(context: Context) {
            val request = OneTimeWorkRequestBuilder<GlucoseSyncWorker>()
                .addTag(WORK_TAG)
                .setConstraints(NETWORK_CONSTRAINT)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(
                    ONE_SHOT_WORK_NAME,
                    ExistingWorkPolicy.REPLACE,
                    request,
                )
        }

        /**
         * Register a 15-minute periodic job as a fallback for devices where
         * Health Connect change notifications do not fire reliably.
         * Uses KEEP so a re-registration on every [MainActivity.onCreate]
         * does not reset the interval.
         */
        fun schedulePeriodic(context: Context) {
            val request = PeriodicWorkRequestBuilder<GlucoseSyncWorker>(
                15, TimeUnit.MINUTES,
            )
                .addTag(WORK_TAG)
                .setConstraints(NETWORK_CONSTRAINT)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(
                    PERIODIC_WORK_NAME,
                    ExistingPeriodicWorkPolicy.KEEP,
                    request,
                )
        }
    }

    override suspend fun doWork(): Result {
        val client = try {
            if (HealthConnectClient.getSdkStatus(applicationContext)
                != HealthConnectClient.SDK_AVAILABLE
            ) {
                return Result.success()
            }
            HealthConnectClient.getOrCreate(applicationContext)
        } catch (_: Exception) {
            return Result.success()
        }

        val prefs = applicationContext
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        val storedToken = prefs.getString(PREFS_KEY_TOKEN, null)

        if (storedToken == null) {
            // First run: obtain an initial token so subsequent runs receive
            // only delta changes. Same semantics as iOS anchor=nil returning
            // a new anchor without any samples.
            return try {
                val initialToken = client.getChangesToken(
                    ChangesTokenRequest(setOf(BloodGlucoseRecord::class)),
                )
                prefs.edit().putString(PREFS_KEY_TOKEN, initialToken).apply()
                Result.success()
            } catch (_: Exception) {
                Result.retry()
            }
        }

        // --- Phase 1: Drain all change pages ---
        // getChanges() is paginated; loop until hasMore == false so a burst
        // from a CGM device that uploaded many readings at once is fully consumed.
        // The final token is NOT persisted until after successful HTTP delivery.
        val allSamples = mutableListOf<BloodGlucoseRecord>()
        val finalToken: String
        try {
            var currentToken = storedToken
            var lastToken = storedToken
            do {
                val response = client.getChanges(currentToken)
                response.changes
                    .filterIsInstance<UpsertionChange>()
                    .mapNotNull { it.record as? BloodGlucoseRecord }
                    .forEach { allSamples.add(it) }
                lastToken = response.nextChangesToken
                currentToken = response.nextChangesToken
                if (!response.hasMore) break
            } while (true)
            finalToken = lastToken
        } catch (e: Exception) {
            val msg = e.message ?: e.javaClass.simpleName
            if (msg.contains("CHANGES_TOKEN_EXPIRED", ignoreCase = true) ||
                msg.contains("ChangesTokenExpiredException", ignoreCase = true)
            ) {
                // Token too old — drop it so the next run starts fresh.
                // The foreground sync will back-fill the gap via its
                // time-window query in appleHealthClient.ts.
                prefs.edit().remove(PREFS_KEY_TOKEN).apply()
                return Result.success()
            }
            return Result.retry()
        }

        if (allSamples.isEmpty()) {
            // No new blood-glucose data; advance token even without a POST
            // because the changes might be deletions or other record types.
            prefs.edit().putString(PREFS_KEY_TOKEN, finalToken).apply()
            return Result.success()
        }

        // --- Phase 2: POST, then advance token on success ---
        // CookieManager must be read on the main thread.
        val cookieHeader = withContext(Dispatchers.Main) {
            CookieManager.getInstance().getCookie("https://glev.app") ?: ""
        }

        val statusCode = try {
            postSamples(allSamples, cookieHeader)
        } catch (_: Exception) {
            // Network / IO error — retry without advancing the token so the
            // same samples are re-sent once connectivity is restored.
            return Result.retry()
        }

        return when (statusCode) {
            in 200..299 -> {
                // Delivery confirmed — safe to advance the token.
                prefs.edit().putString(PREFS_KEY_TOKEN, finalToken).apply()
                Result.success()
            }
            401, 403 -> {
                // Session expired / user logged out. Retrying won't help
                // without new credentials. Don't advance the token: the
                // foreground sync will post these samples after re-login
                // (it queries by time-window, not by token).
                Result.success()
            }
            413 -> {
                // Batch exceeds server's MAX_BATCH (500 samples). This is
                // pathological for a CGM delta but we must not get stuck
                // indefinitely — advance the token and let foreground sync
                // back-fill via its time-window query.
                prefs.edit().putString(PREFS_KEY_TOKEN, finalToken).apply()
                Result.success()
            }
            in 500..599 -> {
                // Transient server error — retry without advancing token.
                Result.retry()
            }
            else -> {
                // Unknown status — retry conservatively.
                Result.retry()
            }
        }
    }

    /**
     * Serialises [samples] to the same JSON shape the iOS shell posts and
     * fires a plain HTTP POST. Values are sent in mmol/L because Health
     * Connect stores blood glucose in mmol/L internally; the server
     * normalises to mg/dL (factor 18.0182) in a single place.
     *
     * @return The HTTP status code. Throws on network / IO error so the
     *         caller can distinguish "no response" from "bad response".
     */
    private suspend fun postSamples(
        samples: List<BloodGlucoseRecord>,
        cookieHeader: String,
    ): Int = withContext(Dispatchers.IO) {
        val payload = JSONArray()
        for (s in samples) {
            payload.put(
                JSONObject().apply {
                    put("uuid", s.metadata.id)
                    put(
                        "startDate",
                        s.time.atOffset(ZoneOffset.UTC).format(ISO_FORMATTER),
                    )
                    put("value", s.level.inMillimolesPerLiter)
                    put("unit", "mmol/L")
                },
            )
        }
        val bodyBytes = JSONObject().apply { put("samples", payload) }
            .toString()
            .toByteArray(Charsets.UTF_8)

        val conn = URL(SYNC_ENDPOINT).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Content-Length", bodyBytes.size.toString())
            if (cookieHeader.isNotBlank()) {
                conn.setRequestProperty("Cookie", cookieHeader)
            }
            conn.connectTimeout = TIMEOUT_MS
            conn.readTimeout = TIMEOUT_MS
            conn.doOutput = true
            conn.outputStream.use { it.write(bodyBytes) }
            conn.responseCode
        } finally {
            conn.disconnect()
        }
    }
}
