import type { LabelSet } from "@catalyst-auth/contracts";

const structuredCloneFn: (<T>(value: T) => T) | undefined =
  (globalThis as unknown as { structuredClone?: <T>(value: T) => T }).structuredClone;

export const clone = <T>(value: T): T => {
  if (value === undefined || value === null) {
    return value;
  }

  if (structuredCloneFn) {
    return structuredCloneFn(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
};

export const dedupeScopes = (scopes: ReadonlyArray<string>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const scope of scopes) {
    if (seen.has(scope)) {
      continue;
    }
    seen.add(scope);
    result.push(scope);
  }
  return result;
};

export const normalizeLabels = (labels: LabelSet | undefined): LabelSet => {
  if (!labels) {
    return {};
  }
  return { ...labels };
};
