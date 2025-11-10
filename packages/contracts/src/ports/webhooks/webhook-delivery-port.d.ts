import type { Result } from "../../types/result.js";
import type { CatalystError } from "../../types/domain-error.js";
export interface WebhookEndpoint {
    readonly id: string;
    readonly url: string;
    readonly secret: string;
    readonly eventTypes: ReadonlyArray<string>;
    readonly headers?: Record<string, string>;
    readonly retryPolicy?: WebhookRetryPolicy;
}
export interface WebhookRetryPolicy {
    readonly maxAttempts: number;
    readonly backoffSeconds: ReadonlyArray<number>;
    readonly deadLetterUri?: string;
}
export interface WebhookEventPayload {
    readonly id: string;
    readonly type: string;
    readonly occurredAt: string;
    readonly data: Record<string, unknown>;
    readonly labels?: Record<string, string>;
}
export interface DeliveryResult {
    readonly attempt: number;
    readonly delivered: boolean;
    readonly statusCode?: number;
    readonly errorMessage?: string;
    readonly nextAttemptAt?: string;
}
export interface WebhookDeliveryPort {
    deliver(event: WebhookEventPayload, endpoint: WebhookEndpoint): Promise<Result<DeliveryResult, CatalystError>>;
    scheduleRetry(event: WebhookEventPayload, endpoint: WebhookEndpoint, previous: DeliveryResult): Promise<void>;
}
//# sourceMappingURL=webhook-delivery-port.d.ts.map