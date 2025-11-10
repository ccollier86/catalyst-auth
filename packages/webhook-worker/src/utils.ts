export const clone = <TValue>(value: TValue): TValue => {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value) as TValue;
  }

  return JSON.parse(JSON.stringify(value)) as TValue;
};

export const toHeadersRecord = (
  input: Iterable<[string, string]> | undefined,
): Record<string, string> => {
  if (!input) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, value] of input) {
    result[key] = value;
  }
  return result;
};

export const mergeHeaders = (
  base: Record<string, string> | undefined,
  extra: Record<string, string> | undefined,
): Record<string, string> => ({
  ...(base ?? {}),
  ...(extra ?? {}),
});
