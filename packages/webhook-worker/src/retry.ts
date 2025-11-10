import type { WebhookRetryPolicy } from "@catalyst-auth/contracts";

import type { Clock } from "./types.js";

const defaultPolicy: WebhookRetryPolicy = {
  maxAttempts: 3,
  backoffSeconds: [30, 60, 120],
};

const clonePolicy = (policy: WebhookRetryPolicy): WebhookRetryPolicy => ({
  maxAttempts: policy.maxAttempts,
  backoffSeconds: [...policy.backoffSeconds],
  deadLetterUri: policy.deadLetterUri,
});

const resolvePolicy = (policy?: WebhookRetryPolicy): WebhookRetryPolicy => {
  if (!policy) {
    return clonePolicy(defaultPolicy);
  }
  if (!Array.isArray(policy.backoffSeconds) || policy.backoffSeconds.length === 0) {
    return {
      maxAttempts: policy.maxAttempts ?? defaultPolicy.maxAttempts,
      backoffSeconds: [...defaultPolicy.backoffSeconds],
      deadLetterUri: policy.deadLetterUri,
    } satisfies WebhookRetryPolicy;
  }
  return {
    maxAttempts: policy.maxAttempts ?? defaultPolicy.maxAttempts,
    backoffSeconds: [...policy.backoffSeconds],
    deadLetterUri: policy.deadLetterUri,
  } satisfies WebhookRetryPolicy;
};

const getDelaySeconds = (policy: WebhookRetryPolicy, attemptNumber: number): number => {
  const index = Math.min(Math.max(attemptNumber - 1, 0), policy.backoffSeconds.length - 1);
  const value = policy.backoffSeconds[index];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : defaultPolicy.backoffSeconds[0];
};

export interface RetryDecision {
  readonly shouldRetry: boolean;
  readonly nextAttemptAt?: string;
  readonly deadLetterUri?: string;
}

export const determineRetryDecision = (
  attemptNumber: number,
  policy: WebhookRetryPolicy | undefined,
  clock: Clock,
): RetryDecision => {
  const resolved = resolvePolicy(policy);
  if (attemptNumber >= resolved.maxAttempts) {
    return { shouldRetry: false, deadLetterUri: resolved.deadLetterUri } satisfies RetryDecision;
  }

  const delaySeconds = getDelaySeconds(resolved, attemptNumber);
  const now = clock.now();
  const nextAttempt = new Date(now.getTime() + delaySeconds * 1000);
  return {
    shouldRetry: true,
    nextAttemptAt: nextAttempt.toISOString(),
    deadLetterUri: resolved.deadLetterUri,
  } satisfies RetryDecision;
};
