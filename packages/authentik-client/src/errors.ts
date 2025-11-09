import type { CatalystError, InfraError } from "@catalyst-auth/contracts";

export const createInfraError = (
  code: string,
  message: string,
  details?: Record<string, unknown>,
  retryable = true,
): InfraError => ({
  code,
  message,
  details,
  retryable,
});

export const createDomainError = (
  code: string,
  message: string,
  details?: Record<string, unknown>,
): CatalystError => ({
  code,
  message,
  details,
});

export const unknownError = (cause: unknown, context: string): InfraError => ({
  code: "AUTHENTIK_CLIENT_UNKNOWN",
  message: `Unexpected error while ${context}`,
  details: {
    cause: cause instanceof Error ? cause.message : String(cause),
  },
  retryable: true,
});
