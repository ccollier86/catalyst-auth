import { createHash } from "node:crypto";

type JsonValue = null | boolean | number | string | JsonValue[] | { readonly [key: string]: JsonValue };

const normalize = (value: unknown): JsonValue => {
  if (value === null) {
    return null;
  }
  if (value === undefined) {
    return null;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalize(item)) as JsonValue;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, inner]) => inner !== undefined)
    .map(([key, inner]) => [key, normalize(inner)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries) as JsonValue;
};

export const stableStringify = (value: unknown): string => JSON.stringify(normalize(value));

export const computeSpecHash = (value: unknown): string =>
  createHash("sha256").update(stableStringify(value)).digest("hex");

export interface JsonDiff {
  readonly before: unknown;
  readonly after: unknown;
}

export const createDiff = (before: unknown, after: unknown): JsonDiff => ({ before, after });
