import type { CatalystError } from "../../types/domain-error.js";
import type { Result } from "../../types/result.js";
import type { WebhookRetryPolicy } from "./webhook-delivery-port.js";
export interface WebhookSubscriptionRecord {
    readonly id: string;
    readonly orgId?: string;
    readonly eventTypes: ReadonlyArray<string>;
    readonly targetUrl: string;
    readonly secret: string;
    readonly headers: Record<string, string>;
    readonly retryPolicy?: WebhookRetryPolicy;
    readonly active: boolean;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly metadata?: Record<string, unknown>;
}
export interface CreateWebhookSubscriptionInput {
    readonly id?: string;
    readonly orgId?: string;
    readonly eventTypes: ReadonlyArray<string>;
    readonly targetUrl: string;
    readonly secret: string;
    readonly headers?: Record<string, string>;
    readonly retryPolicy?: WebhookRetryPolicy;
    readonly metadata?: Record<string, unknown>;
    readonly active?: boolean;
    readonly createdAt?: string;
    readonly updatedAt?: string;
}
export interface UpdateWebhookSubscriptionInput {
    readonly orgId?: string | null;
    readonly eventTypes?: ReadonlyArray<string>;
    readonly targetUrl?: string;
    readonly secret?: string;
    readonly headers?: Record<string, string> | null;
    readonly retryPolicy?: WebhookRetryPolicy | null;
    readonly metadata?: Record<string, unknown> | null;
    readonly active?: boolean;
    readonly updatedAt?: string;
}
export interface ListWebhookSubscriptionsOptions {
    readonly orgId?: string | null;
    readonly active?: boolean;
    readonly eventType?: string;
}
export interface WebhookSubscriptionStorePort {
    createSubscription(input: CreateWebhookSubscriptionInput): Promise<Result<WebhookSubscriptionRecord, CatalystError>>;
    updateSubscription(id: string, input: UpdateWebhookSubscriptionInput): Promise<Result<WebhookSubscriptionRecord, CatalystError>>;
    getSubscription(id: string): Promise<Result<WebhookSubscriptionRecord | undefined, CatalystError>>;
    listSubscriptions(options?: ListWebhookSubscriptionsOptions): Promise<Result<ReadonlyArray<WebhookSubscriptionRecord>, CatalystError>>;
    deleteSubscription(id: string): Promise<Result<void, CatalystError>>;
}
//# sourceMappingURL=webhook-subscription-store-port.d.ts.map