import type { CatalystError } from "@catalyst-auth/contracts";

/**
 * Creates a standardized validation error for SDK input payloads.
 */
export const createValidationError = (details: string): CatalystError => ({
  code: "sdk.validation_failed",
  message: "The provided payload failed validation.",
  details: {
    issues: details,
  },
});

/**
 * Creates a standardized not-found error for SDK flows.
 */
export const createNotFoundError = (entity: string, details?: Record<string, unknown>): CatalystError => ({
  code: "sdk.not_found",
  message: `${entity} was not found.`,
  details,
});

/**
 * Creates an operation error when an upstream call fails.
 */
export const createOperationError = (
  code: string,
  message: string,
  details?: Record<string, unknown>,
): CatalystError => ({
  code,
  message,
  details,
});
