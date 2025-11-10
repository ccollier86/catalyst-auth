import type { CatalystError } from "../types/domain-error.js";
import type { McpActionDescriptor, McpChangeKind, McpRunId, McpRunbookMetadata } from "./runbook.js";

export type McpRunnerMode = "plan" | "apply";

export interface McpTelemetryErrorDetails {
  readonly message: string;
  readonly code?: string | undefined;
  readonly cause?: CatalystError | undefined;
}

export interface McpRunbookTelemetryEvent {
  readonly runId: McpRunId;
  readonly mode: McpRunnerMode;
  readonly timestamp: string;
  readonly runbook: McpRunbookMetadata;
}

export interface McpRunbookCompletedEvent extends McpRunbookTelemetryEvent {
  readonly durationMs: number;
  readonly status: "success" | "error";
  readonly error?: McpTelemetryErrorDetails | undefined;
}

export interface McpActionTelemetryEvent extends McpRunbookTelemetryEvent {
  readonly action: McpActionDescriptor;
  readonly change: McpChangeKind;
}

export interface McpActionAppliedEvent extends McpActionTelemetryEvent {
  readonly outcome: "applied" | "noop" | "skipped" | "failed";
  readonly error?: McpTelemetryErrorDetails | undefined;
}

export interface McpTelemetryHooks {
  readonly onRunbookStarted?: (event: McpRunbookTelemetryEvent) => void | Promise<void>;
  readonly onRunbookCompleted?: (event: McpRunbookCompletedEvent) => void | Promise<void>;
  readonly onActionEvaluated?: (event: McpActionTelemetryEvent) => void | Promise<void>;
  readonly onActionApplied?: (event: McpActionAppliedEvent) => void | Promise<void>;
}
