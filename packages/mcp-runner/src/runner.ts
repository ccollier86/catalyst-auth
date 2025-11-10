import { randomUUID } from "node:crypto";

import type {
  AuthentikResourcePort,
  AuthentikResourceSpec,
  AuthentikRunbookAction,
  McpAction,
  McpActionAppliedEvent,
  McpActionDescriptor,
  McpActionTelemetryEvent,
  McpApplyOptions,
  McpApplyResult,
  McpAppliedAction,
  McpPlanResult,
  McpPlannedAction,
  McpRunId,
  McpRunbook,
  McpRunbookCompletedEvent,
  McpRunbookMetadata,
  McpRunbookTelemetryEvent,
  McpTelemetryErrorDetails,
  McpTelemetryHooks,
} from "@catalyst-auth/contracts";
import type { CatalystError, Result } from "@catalyst-auth/contracts";

import { computeSpecHash, createDiff } from "./diff.js";
import {
  createPostgresStateStore,
  type McpStateStore,
  type SqlClient,
  type StoredActionState,
} from "./state-store.js";

export interface McpRunnerDependencies {
  readonly authentik: AuthentikResourcePort;
  readonly pool: SqlClient;
  readonly telemetry?: McpTelemetryHooks | undefined;
  readonly now?: () => Date;
}

class McpRunnerError extends Error {
  constructor(readonly detail: CatalystError) {
    super(detail.message);
    this.name = "McpRunnerError";
  }
}

const unwrap = <T>(result: Result<T, CatalystError>): T => {
  if (result.ok) {
    return result.value;
  }
  throw new McpRunnerError(result.error);
};

const getRunbookMetadata = (runbook: McpRunbook): McpRunbookMetadata => ({
  name: runbook.name,
  version: runbook.version,
  description: runbook.description,
  labels: runbook.labels,
});

const toDescriptor = (action: McpAction): McpActionDescriptor => ({
  id: action.id,
  name: action.name,
  kind: action.kind,
  description: action.description,
});

const createRunId = (): McpRunId => ({ value: randomUUID() });

const emit = async <T>(hook: ((event: T) => void | Promise<void>) | undefined, payload: T): Promise<void> => {
  if (!hook) {
    return;
  }
  await hook(payload);
};

const emitRunbookStarted = (
  hooks: McpTelemetryHooks | undefined,
  event: McpRunbookTelemetryEvent,
) => emit(hooks?.onRunbookStarted, event);

const emitRunbookCompleted = (
  hooks: McpTelemetryHooks | undefined,
  event: McpRunbookCompletedEvent,
) => emit(hooks?.onRunbookCompleted, event);

const emitActionEvaluated = (
  hooks: McpTelemetryHooks | undefined,
  event: McpActionTelemetryEvent,
) => emit(hooks?.onActionEvaluated, event);

const emitActionApplied = (
  hooks: McpTelemetryHooks | undefined,
  event: McpActionAppliedEvent,
) => emit(hooks?.onActionApplied, event);

interface PlannedComputation {
  readonly plan: McpPlannedAction;
  readonly desiredHash?: string | undefined;
  readonly source: McpAction;
}

interface PlanContext {
  readonly authentik: AuthentikResourcePort;
  readonly stateStore: McpStateStore;
  readonly runbook: McpRunbook;
}

const hashSpec = (spec: AuthentikResourceSpec): string => computeSpecHash(spec.properties);

const mergePlanMetadata = (
  plan: Omit<McpPlannedAction, "lastAppliedAt" | "previousHash">,
  previous: StoredActionState | null,
): McpPlannedAction => ({
  ...plan,
  lastAppliedAt: previous?.appliedAt,
  previousHash: previous?.specHash,
});

const planAuthentikEnsure = async (
  ctx: PlanContext,
  action: AuthentikRunbookAction & { kind: "authentik.ensure" },
  previous: StoredActionState | null,
): Promise<PlannedComputation> => {
  const selector = {
    kind: action.spec.kind,
    id: action.spec.id,
    lookup: action.spec.lookup,
  };
  const currentResult = await ctx.authentik.describeResource(selector);
  const current = unwrap(currentResult);
  const desiredHash = hashSpec(action.spec);
  const planned = (): PlannedComputation => {
    if (!current) {
      return {
        plan: mergePlanMetadata(
          {
            id: action.id,
            name: action.name,
            kind: action.kind,
            description: action.description,
            dependsOn: action.dependsOn,
            change: "create",
            diff: createDiff(null, action.spec.properties),
          },
          previous,
        ),
        desiredHash,
        source: action,
      };
    }
    const currentHash = computeSpecHash(current.properties);
    if (currentHash === desiredHash) {
      return {
        plan: mergePlanMetadata(
          {
            id: action.id,
            name: action.name,
            kind: action.kind,
            description: action.description,
            dependsOn: action.dependsOn,
            change: "noop",
          },
          previous,
        ),
        desiredHash,
        source: action,
      };
    }
    return {
      plan: mergePlanMetadata(
        {
          id: action.id,
          name: action.name,
          kind: action.kind,
          description: action.description,
          dependsOn: action.dependsOn,
          change: "update",
          diff: createDiff(current.properties, action.spec.properties),
        },
        previous,
      ),
      desiredHash,
      source: action,
    };
  };
  return planned();
};

const planAuthentikDelete = async (
  ctx: PlanContext,
  action: AuthentikRunbookAction & { kind: "authentik.delete" },
  previous: StoredActionState | null,
): Promise<PlannedComputation> => {
  const currentResult = await ctx.authentik.describeResource(action.selector);
  const current = unwrap(currentResult);
  if (!current) {
    return {
      plan: mergePlanMetadata(
        {
          id: action.id,
          name: action.name,
          kind: action.kind,
          description: action.description,
          dependsOn: action.dependsOn,
          change: "noop",
        },
        previous,
      ),
      source: action,
    };
  }
  return {
    plan: mergePlanMetadata(
      {
        id: action.id,
        name: action.name,
        kind: action.kind,
        description: action.description,
        dependsOn: action.dependsOn,
        change: "delete",
        diff: createDiff(current.properties, null),
      },
      previous,
    ),
    source: action,
  };
};

const planAction = async (ctx: PlanContext, action: McpAction): Promise<PlannedComputation> => {
  const previous = await ctx.stateStore.read(ctx.runbook.name, action.id);
  switch (action.kind) {
    case "authentik.ensure":
      return planAuthentikEnsure(ctx, action, previous);
    case "authentik.delete":
      return planAuthentikDelete(ctx, action, previous);
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
};

const validateRunbook = (runbook: McpRunbook): void => {
  const identifiers = new Set<string>();
  for (const action of runbook.actions) {
    if (identifiers.has(action.id)) {
      throw new Error(`Duplicate action id detected: ${action.id}`);
    }
    identifiers.add(action.id);
  }
  for (const action of runbook.actions) {
    for (const dependency of action.dependsOn ?? []) {
      if (!identifiers.has(dependency)) {
        throw new Error(`Action ${action.id} references unknown dependency ${dependency}`);
      }
    }
  }
};

export interface McpRunner {
  readonly plan: (runbook: McpRunbook) => Promise<McpPlanResult>;
  readonly apply: (runbook: McpRunbook, options?: McpApplyOptions) => Promise<McpApplyResult>;
}

export const createMcpRunner = (deps: McpRunnerDependencies): McpRunner => {
  const stateStore = createPostgresStateStore(deps.pool);
  const now = deps.now ?? (() => new Date());

  const plan = async (runbook: McpRunbook): Promise<McpPlanResult> => {
    validateRunbook(runbook);
    const metadata = getRunbookMetadata(runbook);
    const runId = createRunId();
    const startedAt = now();
    await emitRunbookStarted(deps.telemetry, {
      runId,
      mode: "plan",
      timestamp: startedAt.toISOString(),
      runbook: metadata,
    });

    try {
      const context: PlanContext = { authentik: deps.authentik, stateStore, runbook };
      const computations: PlannedComputation[] = [];
      for (const action of runbook.actions) {
        const computation = await planAction(context, action);
        computations.push(computation);
        await emitActionEvaluated(deps.telemetry, {
          runId,
          mode: "plan",
          timestamp: now().toISOString(),
          runbook: metadata,
          action: toDescriptor(action),
          change: computation.plan.change,
        });
      }
      const generatedAt = now().toISOString();
      const result: McpPlanResult = {
        runbook: metadata,
        generatedAt,
        actions: computations.map((item) => item.plan),
        hasChanges: computations.some((item) => item.plan.change !== "noop"),
      };
      await emitRunbookCompleted(deps.telemetry, {
        runId,
        mode: "plan",
        timestamp: now().toISOString(),
        runbook: metadata,
        durationMs: now().getTime() - startedAt.getTime(),
        status: "success",
      });
      return result;
    } catch (error) {
      const telemetryError: McpTelemetryErrorDetails = {
        message: error instanceof Error ? error.message : "Unknown error",
        cause: error instanceof McpRunnerError ? error.detail : undefined,
      };
      await emitRunbookCompleted(deps.telemetry, {
        runId,
        mode: "plan",
        timestamp: now().toISOString(),
        runbook: metadata,
        durationMs: now().getTime() - startedAt.getTime(),
        status: "error",
        error: telemetryError,
      });
      throw error;
    }
  };

  const apply = async (runbook: McpRunbook, options: McpApplyOptions = {}): Promise<McpApplyResult> => {
    validateRunbook(runbook);
    const metadata = getRunbookMetadata(runbook);
    const dryRun = options.dryRun ?? false;
    const runId = createRunId();
    const startedAt = now();
    await emitRunbookStarted(deps.telemetry, {
      runId,
      mode: "apply",
      timestamp: startedAt.toISOString(),
      runbook: metadata,
    });

    const context: PlanContext = { authentik: deps.authentik, stateStore, runbook };
    const computations: PlannedComputation[] = [];
    for (const action of runbook.actions) {
      const computation = await planAction(context, action);
      computations.push(computation);
      await emitActionEvaluated(deps.telemetry, {
        runId,
        mode: "apply",
        timestamp: now().toISOString(),
        runbook: metadata,
        action: toDescriptor(action),
        change: computation.plan.change,
      });
    }

    const statusById = new Map<string, McpActionAppliedEvent["outcome"]>();
    const appliedActions: McpAppliedAction[] = [];
    const actionErrors: McpTelemetryErrorDetails[] = [];

    for (const computation of computations) {
      const action = computation.source;
      const descriptor = toDescriptor(action);
      const timestamp = now().toISOString();
      const dependencies = action.dependsOn ?? [];
      const blockedBy = dependencies.find((dependency) => {
        const status = statusById.get(dependency);
        return status === "failed" || status === "skipped";
      });

      if (blockedBy) {
        const message = `Blocked by dependency ${blockedBy}`;
        const telemetryEvent: McpActionAppliedEvent = {
          runId,
          mode: "apply",
          timestamp,
          runbook: metadata,
          action: descriptor,
          change: computation.plan.change,
          outcome: "skipped",
          error: { message },
        };
        await emitActionApplied(deps.telemetry, telemetryEvent);
        appliedActions.push({
          ...computation.plan,
          applied: false,
          skipped: true,
          error: message,
        });
        statusById.set(action.id, "skipped");
        continue;
      }

      if (dryRun && computation.plan.change !== "noop") {
        const telemetryEvent: McpActionAppliedEvent = {
          runId,
          mode: "apply",
          timestamp,
          runbook: metadata,
          action: descriptor,
          change: computation.plan.change,
          outcome: "skipped",
          error: { message: "dry-run" },
        };
        await emitActionApplied(deps.telemetry, telemetryEvent);
        appliedActions.push({
          ...computation.plan,
          applied: false,
          skipped: true,
          error: "dry-run",
        });
        statusById.set(action.id, "skipped");
        continue;
      }

      try {
        let outcome: McpActionAppliedEvent["outcome"] = "noop";
        if (action.kind === "authentik.ensure") {
          if (computation.plan.change === "create") {
            unwrap(await deps.authentik.createResource(action.spec));
            outcome = "applied";
          } else if (computation.plan.change === "update") {
            unwrap(await deps.authentik.updateResource(action.spec));
            outcome = "applied";
          }
          if (computation.desiredHash) {
            await stateStore.write(runbook.name, action.id, computation.desiredHash, timestamp);
          }
        } else if (action.kind === "authentik.delete") {
          if (computation.plan.change === "delete") {
            unwrap(await deps.authentik.deleteResource(action.selector));
            outcome = "applied";
          }
          await stateStore.remove(runbook.name, action.id);
        }
        const telemetryEvent: McpActionAppliedEvent = {
          runId,
          mode: "apply",
          timestamp,
          runbook: metadata,
          action: descriptor,
          change: computation.plan.change,
          outcome,
        };
        await emitActionApplied(deps.telemetry, telemetryEvent);
        appliedActions.push({
          ...computation.plan,
          applied: outcome === "applied",
          skipped: false,
        });
        statusById.set(action.id, outcome);
      } catch (error) {
        const telemetryError: McpTelemetryErrorDetails = {
          message: error instanceof Error ? error.message : "Unknown error",
          cause: error instanceof McpRunnerError ? error.detail : undefined,
        };
        const telemetryEvent: McpActionAppliedEvent = {
          runId,
          mode: "apply",
          timestamp,
          runbook: metadata,
          action: descriptor,
          change: computation.plan.change,
          outcome: "failed",
          error: telemetryError,
        };
        await emitActionApplied(deps.telemetry, telemetryEvent);
        appliedActions.push({
          ...computation.plan,
          applied: false,
          skipped: false,
          error: telemetryError.message,
        });
        statusById.set(action.id, "failed");
        actionErrors.push(telemetryError);
      }
    }

    const completedAt = now();
    const result: McpApplyResult = {
      runbook: metadata,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      dryRun,
      actions: appliedActions,
    };

    await emitRunbookCompleted(deps.telemetry, {
      runId,
      mode: "apply",
      timestamp: completedAt.toISOString(),
      runbook: metadata,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      status: actionErrors.length > 0 ? "error" : "success",
      error: actionErrors[0],
    });

    return result;
  };

  return { plan, apply } satisfies McpRunner;
};
