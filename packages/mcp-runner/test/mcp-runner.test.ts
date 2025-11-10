import { describe, expect, it } from "vitest";

import type {
  AuthentikResourcePort,
  AuthentikResourceSelector,
  AuthentikResourceSpec,
  AuthentikResourceState,
  McpRunbook,
} from "@catalyst-auth/contracts";
import { err, ok } from "@catalyst-auth/contracts";

import { createMcpRunner } from "../src/runner.js";

const createTestPool = async () => {
  const { newDb } = await import("pg-mem");
  const db = newDb();
  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();
  return pool;
};

interface StoredResource {
  readonly spec: AuthentikResourceSpec;
  readonly state: AuthentikResourceState;
}

class FakeAuthentikClient implements AuthentikResourcePort {
  private readonly resources = new Map<string, StoredResource>();

  constructor(initial: StoredResource[] = []) {
    for (const resource of initial) {
      this.resources.set(this.key(resource.spec), resource);
    }
  }

  private key(selector: AuthentikResourceSelector | AuthentikResourceSpec): string {
    const parts = [selector.kind];
    if (selector.id) {
      parts.push(selector.id);
    }
    if (selector.lookup) {
      for (const [name, value] of Object.entries(selector.lookup)) {
        parts.push(`${name}:${value}`);
      }
    }
    return parts.join(":");
  }

  async describeResource(selector: AuthentikResourceSelector) {
    const existing = this.resources.get(this.key(selector));
    return ok(existing ? existing.state : null);
  }

  async createResource(spec: AuthentikResourceSpec) {
    if (!spec.id && !spec.lookup) {
      return err({ code: "invalid_spec", message: "id or lookup required" });
    }
    const state: AuthentikResourceState = {
      selector: { kind: spec.kind, id: spec.id, lookup: spec.lookup },
      properties: spec.properties,
      revision: Date.now().toString(),
    };
    this.resources.set(this.key(spec), { spec, state });
    return ok(state);
  }

  async updateResource(spec: AuthentikResourceSpec) {
    const key = this.key(spec);
    const existing = this.resources.get(key);
    if (!existing) {
      return err({ code: "not_found", message: "resource missing" });
    }
    const state: AuthentikResourceState = {
      selector: existing.state.selector,
      properties: spec.properties,
      revision: Date.now().toString(),
    };
    this.resources.set(key, { spec, state });
    return ok(state);
  }

  async deleteResource(selector: AuthentikResourceSelector) {
    this.resources.delete(this.key(selector));
    return ok(null);
  }
}

describe("mcp runner", () => {
  it("plans, applies, and converges runbooks", async () => {
    const pool = await createTestPool();
    const authentik = new FakeAuthentikClient([
      {
        spec: {
          kind: "application",
          id: "legacy-app",
          properties: { name: "legacy" },
        },
        state: {
          selector: { kind: "application", id: "legacy-app" },
          properties: { name: "legacy" },
          revision: "1",
        },
      },
    ]);

    const runner = createMcpRunner({ authentik, pool });

    const runbook: McpRunbook = {
      name: "smoke-test",
      version: "1.0.0",
      actions: [
        {
          id: "ensure-provider",
          kind: "authentik.ensure",
          name: "Ensure provider",
          spec: {
            kind: "provider",
            id: "provider-1",
            properties: { name: "example", url: "https://example.dev" },
          },
        },
        {
          id: "cleanup-legacy",
          kind: "authentik.delete",
          name: "Remove legacy app",
          selector: { kind: "application", id: "legacy-app" },
          dependsOn: ["ensure-provider"],
        },
      ],
    };

    const initialPlan = await runner.plan(runbook);
    expect(initialPlan.hasChanges).toBe(true);
    expect(initialPlan.actions.map((action) => action.change)).toEqual(["create", "delete"]);
    expect(initialPlan.actions[0].lastAppliedAt).toBeUndefined();

    const applyResult = await runner.apply(runbook, { dryRun: false });
    expect(applyResult.dryRun).toBe(false);
    expect(applyResult.actions.map((action) => action.applied)).toEqual([true, true]);

    const convergedPlan = await runner.plan(runbook);
    expect(convergedPlan.hasChanges).toBe(false);
    expect(convergedPlan.actions.map((action) => action.change)).toEqual(["noop", "noop"]);
    expect(convergedPlan.actions[0].lastAppliedAt).toBeDefined();

    const dryRun = await runner.apply(runbook, { dryRun: true });
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.actions.map((action) => action.skipped)).toEqual([true, true]);

    await pool.end();
  });
});
