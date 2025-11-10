#!/usr/bin/env node
import { Command } from "commander";
import { stringify as stringifyYaml } from "yaml";

import type { AuthentikResourcePort, McpApplyResult, McpPlanResult, McpRunbook } from "@catalyst-auth/contracts";

import { createMcpRunner } from "../src/runner.js";
import { loadRunbook } from "../src/runbook-loader.js";

const program = new Command();

const OUTPUT_FORMATS = ["json", "yaml"] as const;
type OutputFormat = (typeof OUTPUT_FORMATS)[number];

type BootstrapOptions = {
  readonly databaseUrl?: string | undefined;
  readonly clientModule: string;
  readonly clientConfig?: string | undefined;
};

const loadJson = async (input: string): Promise<unknown> => {
  try {
    return JSON.parse(input);
  } catch {
    const { readFile } = await import("node:fs/promises");
    const contents = await readFile(input, "utf8");
    return JSON.parse(contents);
  }
};

const resolveModule = (specifier: string): string => {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    return new URL(specifier, `file://${process.cwd()}/`).pathname;
  }
  return specifier;
};

const loadAuthentikClient = async (options: BootstrapOptions): Promise<AuthentikResourcePort> => {
  const modulePath = resolveModule(options.clientModule);
  const imported = await import(modulePath);
  const factory =
    typeof imported.createAuthentikClient === "function"
      ? imported.createAuthentikClient
      : typeof imported.default === "function"
        ? imported.default
        : undefined;
  if (!factory) {
    throw new Error(`Module ${options.clientModule} does not export a createAuthentikClient factory`);
  }
  const config = options.clientConfig ? await loadJson(options.clientConfig) : undefined;
  const client = await factory(config);
  return client as AuthentikResourcePort;
};

type PoolLike = {
  query: (queryText: string, values?: ReadonlyArray<unknown>) => Promise<{ rowCount: number; rows: any[] }>;
  end: () => Promise<void>;
};

const createPool = async (databaseUrl?: string): Promise<PoolLike> => {
  const module = (await import("pg")) as { Pool: new (config?: { connectionString?: string }) => PoolLike };
  return databaseUrl ? new module.Pool({ connectionString: databaseUrl }) : new module.Pool();
};

const printResult = (result: McpPlanResult | McpApplyResult, format: OutputFormat): void => {
  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(stringifyYaml(result));
};

const ensureFormat = (value: string): OutputFormat => {
  if (OUTPUT_FORMATS.includes(value as OutputFormat)) {
    return value as OutputFormat;
  }
  throw new Error(`Unsupported output format ${value}. Expected one of: ${OUTPUT_FORMATS.join(", ")}`);
};

const readRunbook = async (path: string): Promise<McpRunbook> => loadRunbook(path);

const bootstrap = async (options: BootstrapOptions) => {
  const authentik = await loadAuthentikClient(options);
  const pool = await createPool(options.databaseUrl);
  return { authentik, pool };
};

program
  .name("catalyst-mcp")
  .description("Run Catalyst MCP automation runbooks");

program
  .option("--database-url <url>", "Postgres connection string", process.env.DATABASE_URL)
  .requiredOption(
    "--client-module <module>",
    "Module that exports a createAuthentikClient function returning an AuthentikResourcePort",
    process.env.MCP_CLIENT_MODULE,
  )
  .option("--client-config <json>", "Inline JSON string or path to JSON configuration for the client");

program
  .command("plan")
  .argument("<runbook>", "Path to the runbook file (JSON or YAML)")
  .option("--format <format>", "Output format (json|yaml)", ensureFormat, "yaml")
  .action(async (runbookPath: string, options: { format: OutputFormat }) => {
    const parent = program.opts();
    const runbook = await readRunbook(runbookPath);
    const { authentik, pool } = await bootstrap({
      databaseUrl: parent.databaseUrl,
      clientModule: parent.clientModule,
      clientConfig: parent.clientConfig,
    });
    try {
      const runner = createMcpRunner({ authentik, pool });
      const plan = await runner.plan(runbook);
      printResult(plan, options.format);
    } finally {
      await pool.end();
    }
  });

program
  .command("apply")
  .argument("<runbook>", "Path to the runbook file (JSON or YAML)")
  .option("--format <format>", "Output format (json|yaml)", ensureFormat, "yaml")
  .option("--execute", "Apply the plan instead of running in dry-run mode", false)
  .action(async (runbookPath: string, options: { format: OutputFormat; execute?: boolean }) => {
    const parent = program.opts();
    const runbook = await readRunbook(runbookPath);
    const { authentik, pool } = await bootstrap({
      databaseUrl: parent.databaseUrl,
      clientModule: parent.clientModule,
      clientConfig: parent.clientConfig,
    });
    try {
      if (!options.execute) {
        console.warn("Running apply in dry-run mode. Pass --execute to apply changes.");
      }
      const runner = createMcpRunner({ authentik, pool });
      const result = await runner.apply(runbook, { dryRun: !options.execute });
      printResult(result, options.format);
    } finally {
      await pool.end();
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
