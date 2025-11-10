import type { AuthentikRunbookAction } from "./authentik.js";

export type McpAction = AuthentikRunbookAction;

export type McpActionKind = McpAction["kind"];

export interface McpRunbookMetadata {
  readonly name: string;
  readonly version: string;
  readonly description?: string | undefined;
  readonly labels?: Readonly<Record<string, string>> | undefined;
}

export interface McpRunbook extends McpRunbookMetadata {
  readonly actions: readonly McpAction[];
}

export interface McpActionDiff {
  readonly before: unknown;
  readonly after: unknown;
}

export type McpChangeKind = "create" | "update" | "delete" | "noop";

export interface McpPlannedAction {
  readonly id: string;
  readonly name: string;
  readonly kind: McpActionKind;
  readonly description?: string | undefined;
  readonly change: McpChangeKind;
  readonly diff?: McpActionDiff | undefined;
  readonly dependsOn?: readonly string[] | undefined;
  readonly lastAppliedAt?: string | undefined;
  readonly previousHash?: string | undefined;
}

export interface McpPlanResult {
  readonly runbook: McpRunbookMetadata;
  readonly generatedAt: string;
  readonly actions: readonly McpPlannedAction[];
  readonly hasChanges: boolean;
}

export interface McpApplyOptions {
  readonly dryRun?: boolean | undefined;
}

export interface McpAppliedAction extends McpPlannedAction {
  readonly applied: boolean;
  readonly skipped: boolean;
  readonly error?: string | undefined;
}

export interface McpApplyResult {
  readonly runbook: McpRunbookMetadata;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly dryRun: boolean;
  readonly actions: readonly McpAppliedAction[];
}

export interface McpRunId {
  readonly value: string;
}

export interface McpActionDescriptor {
  readonly id: string;
  readonly name: string;
  readonly kind: McpActionKind;
  readonly description?: string | undefined;
}
