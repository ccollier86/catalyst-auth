export interface DomainError {
    readonly code: string;
    readonly message: string;
    readonly details?: Record<string, unknown>;
}
export interface InfraError extends DomainError {
    readonly retryable?: boolean;
}
export type CatalystError = DomainError | InfraError;
//# sourceMappingURL=domain-error.d.ts.map