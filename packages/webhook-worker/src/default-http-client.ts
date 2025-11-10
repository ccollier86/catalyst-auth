import { mergeHeaders, toHeadersRecord } from "./utils.js";
import type { HttpClient, HttpRequest, HttpResponse } from "./types.js";

type FetchLikeResponse = {
  readonly status: number;
  readonly headers?: {
    forEach(callback: (value: string, key: string) => void): void;
  };
  text(): Promise<string>;
};

type FetchLike = (
  input: string,
  init?: Record<string, unknown>,
) => Promise<FetchLikeResponse>;

const readResponseHeaders = (
  response: FetchLikeResponse,
): Record<string, string> => {
  if (!response.headers) {
    return {};
  }
  const pairs: Array<[string, string]> = [];
  response.headers.forEach((value, key) => {
    pairs.push([key, value]);
  });
  return toHeadersRecord(pairs);
};

const buildFetchInit = (request: HttpRequest): Record<string, unknown> => {
  const headers = mergeHeaders({}, request.headers);
  return {
    method: request.method ?? "POST",
    headers,
    body: request.body,
  } satisfies Record<string, unknown>;
};

const createDefaultFetch = (): FetchLike | undefined => {
  const fetchFn = (globalThis as Record<string, unknown>).fetch;
  if (typeof fetchFn !== "function") {
    return undefined;
  }
  return fetchFn as FetchLike;
};

export class FetchHttpClient implements HttpClient {
  constructor(private readonly fetchFn: FetchLike = createDefaultFetch() ?? (async () => {
    throw new Error("Fetch API is not available in this environment.");
  })) {}

  async execute(request: HttpRequest): Promise<HttpResponse> {
    const response = await this.fetchFn(request.url, buildFetchInit(request));
    const body = await response.text();
    return {
      status: response.status,
      headers: readResponseHeaders(response),
      body,
    } satisfies HttpResponse;
  }
}

export const defaultHttpClient = new FetchHttpClient();
