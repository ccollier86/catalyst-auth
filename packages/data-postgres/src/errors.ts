import type { CatalystError, InfraError } from "@catalyst-auth/contracts";

export const createError = (
  code: string,
  message: string,
  details?: Record<string, unknown>,
): CatalystError => ({
  code,
  message,
  details,
});

export const createInfraError = (
  code: string,
  message: string,
  error: unknown,
  details?: Record<string, unknown>,
): InfraError => ({
  code,
  message,
  details: { ...(details ?? {}), cause: normalizeError(error) },
  retryable: true,
});

const normalizeError = (error: unknown): Record<string, unknown> => {
  if (!error || typeof error !== "object") {
    return { message: String(error) };
  }

  const candidate = error as { [key: string]: unknown };
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(candidate)) {
    const value = candidate[key];
    if (value === undefined) {
      continue;
    }
    normalized[key] = value as unknown;
  }

  if ("message" in candidate && typeof candidate.message === "string") {
    normalized.message = candidate.message;
  }

  if (Object.keys(normalized).length === 0) {
    normalized.message = error instanceof Error ? error.message : String(error);
  }

  return normalized;
};
