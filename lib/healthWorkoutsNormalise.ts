/**
 * Shared input normalisation for the Apple-Health workout sync endpoint.
 *
 * Mirrors `lib/healthStepsNormalise.ts` so unit tests assert the SAME
 * function the route handler runs — preventing the mirrored-validator
 * drift a copy/paste test would eventually accrue.
 *
 * Body shape (per workout sample):
 *   {
 *     uuid:        string,   // HealthKit HKWorkout.uuid → external_id
 *     workoutType: string,   // @capgo/capacitor-health WorkoutType slug
 *     startDate:   string,   // ISO 8601
 *     endDate:     string,   // ISO 8601 (must be > startDate)
 *     avgHeartRate?: number, // optional, 1..250 bpm
 *     maxHeartRate?: number, // optional, 1..250 bpm
 *   }
 *
 * The normaliser:
 *   - maps the HealthKit `WorkoutType` slug onto Glev's `ExerciseType`
 *     enum (lib/exercise.ts) — unknown types fall back to "cardio" so
 *     a workout never gets dropped, only generalised.
 *   - clamps duration to the 1..600 minute window enforced by the
 *     `exercise_logs` CHECK constraints.
 *   - defaults intensity to "medium" — HKWorkout has no intensity
 *     field; the engine's safety hook only needs the time window, and
 *     the user can edit intensity later (synced rows allow notes +
 *     intensity edits per the migration UI policy).
 */

export const HEALTH_WORKOUTS_MAX_BATCH = 200;
const MIN_DURATION_MIN = 1;
const MAX_DURATION_MIN = 600;
const MIN_HR = 1;
const MAX_HR = 250;

export interface InboundHealthWorkout {
  uuid?: unknown;
  workoutType?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  avgHeartRate?: unknown;
  maxHeartRate?: unknown;
}

export interface NormalisedHealthWorkoutRow {
  external_id: string;
  exercise_type: string;
  intensity: "low" | "medium" | "high";
  duration_minutes: number;
  started_at: string;
  ended_at: string;
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  notes: null;
}

// HealthKit `WorkoutType` → Glev `ExerciseType`. Anything not listed
// here falls back to "cardio" — the safest generalisation for the
// engine's "exercise within 4h" hook (which only looks at the time
// window today, not the type).
const TYPE_MAP: Record<string, string> = {
  // Run-family
  running: "run",
  runningTreadmill: "run",
  wheelchairRunPace: "run",
  // Cycle-family
  cycling: "cycling",
  handCycling: "cycling",
  bikingStationary: "cycling",
  // Swim/water — collapsed under "swimming" because the engine
  // doesn't yet distinguish water sports.
  swimming: "swimming",
  swimmingPool: "swimming",
  swimmingOpenWater: "swimming",
  waterFitness: "swimming",
  waterPolo: "swimming",
  waterSports: "swimming",
  surfing: "swimming",
  surfingSports: "swimming",
  paddleSports: "swimming",
  paddling: "swimming",
  rowing: "swimming",
  rowingMachine: "swimming",
  // Strength-family
  strengthTraining: "strength",
  traditionalStrengthTraining: "strength",
  functionalStrengthTraining: "strength",
  weightlifting: "strength",
  coreTraining: "strength",
  gymnastics: "strength",
  climbing: "strength",
  rockClimbing: "strength",
  calisthenics: "strength",
  // HIIT-family
  highIntensityIntervalTraining: "hiit",
  crossTraining: "hiit",
  bootCamp: "hiit",
  jumpRope: "hiit",
  stairClimbing: "hiit",
  stairs: "hiit",
  stepTraining: "hiit",
  stairClimbingMachine: "hiit",
  kickboxing: "hiit",
  boxing: "hiit",
  martialArts: "hiit",
  // Mind/body
  yoga: "yoga",
  pilates: "yoga",
  mindAndBody: "yoga",
  taiChi: "yoga",
  barre: "yoga",
  flexibility: "yoga",
  stretching: "yoga",
  meditation: "yoga",
  mindfulness: "yoga",
  // Breathwork
  guidedBreathing: "breathwork",
  // Team / racquet
  soccer: "football",
  americanFootball: "football",
  australianFootball: "football",
  rugby: "football",
  tennis: "tennis",
  tableTennis: "tennis",
  badminton: "tennis",
  squash: "tennis",
  racquetball: "tennis",
  pickleball: "tennis",
  volleyball: "volleyball",
  basketball: "basketball",
  handball: "basketball",
};

export function mapWorkoutType(slug: string): string {
  return TYPE_MAP[slug] ?? "cardio";
}

function parsePositiveHr(raw: unknown): number | null {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  if (r < MIN_HR || r > MAX_HR) return null;
  return r;
}

function parseIsoInstant(raw: unknown): { iso: string; ms: number } | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return { iso: new Date(ms).toISOString(), ms };
}

export function normaliseHealthWorkout(
  w: InboundHealthWorkout,
): NormalisedHealthWorkoutRow | null {
  if (!w || typeof w !== "object") return null;

  const uuid = typeof w.uuid === "string" ? w.uuid.trim() : "";
  if (uuid.length === 0 || uuid.length > 128) return null;

  const slug = typeof w.workoutType === "string" ? w.workoutType.trim() : "";
  if (slug.length === 0) return null;

  const start = parseIsoInstant(w.startDate);
  const end = parseIsoInstant(w.endDate);
  if (!start || !end) return null;
  if (end.ms <= start.ms) return null;

  const durationMin = Math.round((end.ms - start.ms) / 60_000);
  if (durationMin < MIN_DURATION_MIN) return null;
  // Clamp instead of reject — multi-day "workouts" (forgotten Apple
  // Watch sessions) shouldn't blow up the sync; we cap at the CHECK
  // constraint's upper bound so the row still tells the engine
  // "exercise happened in this window".
  const clamped = Math.min(durationMin, MAX_DURATION_MIN);

  return {
    external_id: uuid,
    exercise_type: mapWorkoutType(slug),
    intensity: "medium",
    duration_minutes: clamped,
    started_at: start.iso,
    ended_at: end.iso,
    avg_heart_rate: parsePositiveHr(w.avgHeartRate),
    max_heart_rate: parsePositiveHr(w.maxHeartRate),
    notes: null,
  };
}
