type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

interface UserFacingErrorOptions {
  t?: TranslateFn;
  fallback?: string;
  context?:
    | "auth"
    | "model"
    | "transcription"
    | "agent"
    | "settings"
    | "generic";
}

const DEFAULT_GENERIC_ERROR =
  "Un probleme est survenu. Reessayez dans un instant.";

const TECHNICAL_ERROR_PATTERNS = [
  /^[a-z]+(?:[._:-][a-z0-9]+)+$/i,
  /^[A-Z0-9_:-]{4,}$/,
  /\b(stack|traceback|panic|exception|undefined|null|nan)\b/i,
  /\b(failed to|unable to|could not|cannot|invalid state)\b/i,
  /\b(http|status|jwt|token|uuid|json|serde|tauri|sqlite|database)\b/i,
  /[A-Z]:\\|\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/,
];

const translate = (
  t: TranslateFn | undefined,
  key: string,
  defaultValue: string,
) => (t ? t(key, { defaultValue }) : defaultValue);

export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string") return maybeMessage;
    const maybeError = (error as { error?: unknown }).error;
    if (typeof maybeError === "string") return maybeError;
  }
  return "";
}

export function looksTechnicalError(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  return TECHNICAL_ERROR_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function getUserFacingErrorMessage(
  error: unknown,
  options: UserFacingErrorOptions = {},
): string {
  const raw = extractErrorMessage(error).trim();
  const normalized = raw.toLowerCase();
  const fallback = options.fallback ?? DEFAULT_GENERIC_ERROR;

  if (!raw) {
    return translate(options.t, "errors.userFacing.generic", fallback);
  }

  if (
    raw === "auth.sessionExpired" ||
    normalized.includes("session expired") ||
    normalized.includes("token expired") ||
    normalized.includes("jwt expired") ||
    normalized.includes("unauthorized") ||
    normalized.includes("401")
  ) {
    return translate(
      options.t,
      "auth.sessionExpired",
      "Votre session a expire. Reconnectez-vous pour continuer.",
    );
  }

  if (
    normalized.includes("premium access") ||
    normalized.includes("subscription access") ||
    normalized.includes("license") ||
    normalized.includes("403")
  ) {
    return translate(
      options.t,
      "errors.userFacing.accessRequired",
      "Votre acces doit etre verifie. Reconnectez-vous ou ouvrez votre abonnement.",
    );
  }

  if (
    normalized.includes("network") ||
    normalized.includes("fetch") ||
    normalized.includes("connect") ||
    normalized.includes("connection") ||
    normalized.includes("timed out") ||
    normalized.includes("timeout")
  ) {
    return translate(
      options.t,
      "errors.userFacing.network",
      "Connexion impossible. Verifiez internet, puis reessayez.",
    );
  }

  if (
    normalized.includes("microphone") ||
    normalized.includes("input device") ||
    normalized.includes("audio capture") ||
    normalized.includes("permission denied") ||
    normalized.includes("access denied")
  ) {
    return translate(
      options.t,
      "errors.userFacing.microphone",
      "Vocalype n'arrive pas a utiliser le microphone. Verifiez l'autorisation et le micro selectionne.",
    );
  }

  if (
    normalized.includes("model") ||
    normalized.includes("download") ||
    normalized.includes("extract")
  ) {
    return translate(
      options.t,
      "errors.userFacing.model",
      "Le modele vocal n'a pas pu etre prepare. Verifiez votre connexion et reessayez.",
    );
  }

  if (options.context === "agent") {
    return translate(
      options.t,
      "errors.userFacing.agent",
      "L'assistant n'a pas pu repondre. Reessayez dans un instant.",
    );
  }

  if (looksTechnicalError(raw)) {
    return translate(options.t, "errors.userFacing.generic", fallback);
  }

  return raw;
}
