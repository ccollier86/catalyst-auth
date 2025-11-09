export const trimTrailingSlash = (value: string): string => value.replace(/\/+$/u, "");

export const ensureLeadingSlash = (value: string): string =>
  value.startsWith("/") ? value : `/${value}`;

export const toUrl = (baseUrl: string, path: string): string => {
  const normalisedBase = trimTrailingSlash(baseUrl);
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${normalisedBase}${ensureLeadingSlash(path)}`;
};

export const safeJsonParse = (
  payload: string,
): { readonly data?: unknown; readonly error?: Error } => {
  if (!payload) {
    return { data: undefined };
  }

  try {
    return { data: JSON.parse(payload) };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return { error: err };
  }
};

export const asString = (input: unknown): string | undefined =>
  typeof input === "string" && input.trim().length > 0 ? input : undefined;

export const asStringArray = (input: unknown): ReadonlyArray<string> => {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((value) => {
      if (typeof value === "string") {
        return value;
      }
      if (
        value &&
        typeof value === "object" &&
        "name" in value &&
        typeof (value as { name?: unknown }).name === "string"
      ) {
        return (value as { name: string }).name;
      }
      if (
        value &&
        typeof value === "object" &&
        "slug" in value &&
        typeof (value as { slug?: unknown }).slug === "string"
      ) {
        return (value as { slug: string }).slug;
      }
      return undefined;
    })
    .filter((value): value is string => typeof value === "string");
};

export const asIsoString = (input: unknown): string | undefined => {
  if (typeof input === "string" && !Number.isNaN(Date.parse(input))) {
    return input;
  }
  return undefined;
};

export const normaliseHeaders = (
  headers: Record<string, string | undefined>,
): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
};

export const isRecord = (input: unknown): input is Record<string, unknown> =>
  Boolean(input) && typeof input === "object" && !Array.isArray(input);
