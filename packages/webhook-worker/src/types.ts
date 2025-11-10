import type {
  CatalystError,
  Result,
  WebhookDeliveryRecord,
  WebhookDeliveryStorePort,
  WebhookSubscriptionRecord,
  WebhookSubscriptionStorePort,
} from "@catalyst-auth/contracts";

export interface Clock {
  now(): Date;
}

export interface Logger {
  debug?(message: string, context?: Record<string, unknown>): void;
  info?(message: string, context?: Record<string, unknown>): void;
  warn?(message: string, context?: Record<string, unknown>): void;
  error?(message: string, context?: Record<string, unknown>): void;
}

export interface HttpRequest {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body?: string;
}

export interface HttpClient {
  execute(request: HttpRequest): Promise<HttpResponse>;
}

export interface SignatureGenerator {
  sign(payload: string, secret: string): string;
}

export interface DeliveryAttemptContext {
  readonly delivery: WebhookDeliveryRecord;
  readonly subscription: WebhookSubscriptionRecord;
}

export type StoreResult<TValue> = Promise<Result<TValue, CatalystError>>;

export interface WebhookStores {
  readonly subscriptions: WebhookSubscriptionStorePort;
  readonly deliveries: WebhookDeliveryStorePort;
}

export interface WorkerRunSummary {
  readonly total: number;
  readonly succeeded: number;
  readonly retried: number;
  readonly deadLettered: number;
}

export interface DispatcherEventInput {
  readonly eventId: string;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly orgId?: string | null;
}

export interface DispatcherResult {
  readonly deliveries: ReadonlyArray<WebhookDeliveryRecord>;
}

export type DispatcherOutcome = Result<DispatcherResult, CatalystError>;
