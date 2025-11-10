import type { CatalystError } from "../../types/domain-error.js";
import type { Result } from "../../types/result.js";
export type WebhookDeliveryStatus = "pending" | "delivering" | "succeeded" | "failed" | "dead_lettered";
export interface WebhookDeliveryRecord {
    readonly id: string;
    readonly subscriptionId: string;
    readonly eventId: string;
    readonly status: WebhookDeliveryStatus;
    readonly attemptCount: number;
    readonly lastAttemptAt?: string;
    readonly nextAttemptAt?: string;
    readonly payload: Record<string, unknown>;
    readonly response?: Record<string, unknown>;
    readonly errorMessage?: string;
    readonly createdAt: string;
    readonly updatedAt: string;
}
export interface CreateWebhookDeliveryInput {
    readonly id?: string;
    readonly subscriptionId: string;
    readonly eventId: string;
    readonly status?: WebhookDeliveryStatus;
    readonly attemptCount?: number;
    readonly lastAttemptAt?: string;
    readonly nextAttemptAt?: string;
    readonly payload: Record<string, unknown>;
    readonly response?: Record<string, unknown>;
    readonly errorMessage?: string;
    readonly createdAt?: string;
    readonly updatedAt?: string;
}
export interface UpdateWebhookDeliveryInput {
    readonly status?: WebhookDeliveryStatus;
    readonly attemptCount?: number;
    readonly lastAttemptAt?: string | null;
    readonly nextAttemptAt?: string | null;
    readonly response?: Record<string, unknown> | null;
    readonly errorMessage?: string | null;
    readonly updatedAt?: string;
}
export interface ListWebhookDeliveriesOptions {
    readonly subscriptionId?: string;
    readonly eventId?: string;
    readonly status?: WebhookDeliveryStatus;
    readonly limit?: number;
}
export interface ListPendingDeliveriesOptions {
    readonly before?: string;
    readonly limit?: number;
}
export interface WebhookDeliveryStorePort {
    createDelivery(input: CreateWebhookDeliveryInput): Promise<Result<WebhookDeliveryRecord, CatalystError>>;
    updateDelivery(id: string, input: UpdateWebhookDeliveryInput): Promise<Result<WebhookDeliveryRecord, CatalystError>>;
    getDelivery(id: string): Promise<Result<WebhookDeliveryRecord | undefined, CatalystError>>;
    listDeliveries(options?: ListWebhookDeliveriesOptions): Promise<Result<ReadonlyArray<WebhookDeliveryRecord>, CatalystError>>;
    listPendingDeliveries(options?: ListPendingDeliveriesOptions): Promise<Result<ReadonlyArray<WebhookDeliveryRecord>, CatalystError>>;
    deleteDelivery(id: string): Promise<Result<void, CatalystError>>;
}
//# sourceMappingURL=webhook-delivery-store-port.d.ts.map