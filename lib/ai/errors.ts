/**
 * Centralised error codes for the Glev AI layer.
 *
 * `AppErrorCode` is the discriminated union of all known error states.
 * `AppError` extends `Error` with a typed `code` so any catch-block can
 * inspect the code without parsing a message string.
 *
 * The friendly user-facing messages live in the `ERROR_MESSAGES` map,
 * keyed by code and locale (de / en). They are intentionally inline here
 * (not read from `messages/*.json`) so the map is usable in non-component
 * contexts (server routes, non-React hooks) without the next-intl runtime.
 */

export type AppErrorCode =
  | "CHAT_TIMEOUT"
  | "MISTRAL_RATE_LIMITED"
  | "PARSE_FAILED"
  | "VOICE_ERROR"
  | "NETWORK_ERROR"
  | "AUTH_ERROR"
  | "PERMISSION_DENIED"
  | "UPSTREAM_ERROR"
  | "UNKNOWN";

export const ALL_ERROR_CODES: readonly AppErrorCode[] = [
  "CHAT_TIMEOUT",
  "MISTRAL_RATE_LIMITED",
  "PARSE_FAILED",
  "VOICE_ERROR",
  "NETWORK_ERROR",
  "AUTH_ERROR",
  "PERMISSION_DENIED",
  "UPSTREAM_ERROR",
  "UNKNOWN",
] as const;

export const ERROR_MESSAGES: Record<AppErrorCode, { de: string; en: string }> = {
  CHAT_TIMEOUT: {
    de: "Antwort dauert zu lange — bitte erneut versuchen.",
    en: "Response is taking too long — please try again.",
  },
  MISTRAL_RATE_LIMITED: {
    de: "Zu viele Anfragen — bitte kurz warten und erneut versuchen.",
    en: "Too many requests — please wait a moment and try again.",
  },
  PARSE_FAILED: {
    de: "Deine Nachricht konnte nicht verarbeitet werden — bitte erneut versuchen.",
    en: "Your message could not be processed — please try again.",
  },
  VOICE_ERROR: {
    de: "Spracheingabe fehlgeschlagen — bitte erneut versuchen.",
    en: "Voice input failed — please try again.",
  },
  NETWORK_ERROR: {
    de: "Verbindung fehlgeschlagen — bitte Internetverbindung prüfen.",
    en: "Connection failed — please check your internet connection.",
  },
  AUTH_ERROR: {
    de: "Sitzung abgelaufen — bitte neu anmelden.",
    en: "Session expired — please sign in again.",
  },
  PERMISSION_DENIED: {
    de: "Diese Funktion ist für dein Konto nicht verfügbar.",
    en: "This feature is not available for your account.",
  },
  UPSTREAM_ERROR: {
    de: "Ein unerwarteter Fehler ist aufgetreten — bitte kurz warten und erneut versuchen.",
    en: "An unexpected error occurred — please wait a moment and try again.",
  },
  UNKNOWN: {
    de: "Etwas ist schiefgelaufen — bitte erneut versuchen.",
    en: "Something went wrong — please try again.",
  },
};

/**
 * Codes where retrying the same request makes sense (transient errors).
 * AUTH_ERROR and PERMISSION_DENIED are permanent until the user takes action.
 */
export const RETRY_ALLOWED_CODES: ReadonlySet<AppErrorCode> = new Set<AppErrorCode>([
  "CHAT_TIMEOUT",
  "MISTRAL_RATE_LIMITED",
  "NETWORK_ERROR",
  "UPSTREAM_ERROR",
]);

/**
 * Structured error for the Glev AI layer.
 *
 * `code`  — one of the 9 AppErrorCode values.
 * `cause` — the underlying error or message for server-side logging.
 * `meta`  — optional bag of extra context (also for logging only, never
 *            forwarded to the client response body).
 */
export class AppError extends Error {
  readonly code: AppErrorCode;
  override readonly cause?: unknown;
  readonly meta?: Record<string, unknown>;

  constructor(
    code: AppErrorCode,
    message?: string,
    opts?: { cause?: unknown; meta?: Record<string, unknown> },
  ) {
    super(message ?? code);
    this.name = "AppError";
    this.code = code;
    this.cause = opts?.cause;
    this.meta = opts?.meta;
  }

  /**
   * Returns the human-readable message for this error in the given locale.
   * Defaults to German ("de") since that is the project's default locale.
   */
  toUserMessage(locale: "de" | "en" = "de"): string {
    return ERROR_MESSAGES[this.code]?.[locale] ?? ERROR_MESSAGES.UNKNOWN[locale];
  }
}
