import type { CatalystError } from "./domain-error.js";
export type Result<TValue, TError extends CatalystError = CatalystError> = {
    readonly ok: true;
    readonly value: TValue;
} | {
    readonly ok: false;
    readonly error: TError;
};
export declare const ok: <TValue>(value: TValue) => Result<TValue>;
export declare const err: <TError extends CatalystError>(error: TError) => Result<never, TError>;
//# sourceMappingURL=result.d.ts.map