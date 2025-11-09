import type { CatalystError } from "./domain-error.js";

export type Result<TValue, TError extends CatalystError = CatalystError> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: TError };

export const ok = <TValue>(value: TValue): Result<TValue> => ({ ok: true as const, value });

export const err = <TError extends CatalystError>(error: TError): Result<never, TError> => ({
  ok: false as const,
  error,
});
