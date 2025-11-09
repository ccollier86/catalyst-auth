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
