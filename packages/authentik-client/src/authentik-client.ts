import {
  err as resultErr,
  ok as resultOk,
  type CatalystError,
  type EffectiveIdentity,
  type IdpAdapterPort,
  type IdpUserProfile,
  type Result,
  type SessionDescriptor,
  type TokenExchangeRequest,
  type TokenPair,
  type TokenRefreshRequest,
  type TokenValidationResult,
} from "@catalyst-auth/contracts";

import { createDomainError, createInfraError, unknownError } from "./errors.js";
import {
  AuthentikClientOptions,
  AuthentikRoutes,
  Clock,
  FetchLike,
  IdentityMapper,
} from "./types.js";
import {
  asIsoString,
  asString,
  asStringArray,
  isRecord,
  normaliseHeaders,
  safeJsonParse,
  toUrl,
} from "./utils.js";

interface ResponseEnvelope {
  readonly status: number;
  readonly ok: boolean;
  readonly body: string;
}

const DEFAULT_ROUTES: AuthentikRoutes = {
  tokenPath: "/application/o/token/",
  introspectionPath: "/application/o/introspect/",
  userPath: (userId: string) => `/api/v3/core/users/${userId}/`,
  sessionsPath: (userId: string) => `/api/v3/core/sessions/?user__uuid=${userId}`,
  groupsPath: (userId: string) => `/api/v3/core/groups/?members__uuid=${userId}`,
};

const defaultClock: Clock = {
  now: () => new Date(),
};

const defaultIdentityMapper: IdentityMapper = ({
  profile,
  sessions,
  groups,
  orgId,
}): EffectiveIdentity => ({
  userId: profile.id,
  orgId,
  sessionId: sessions[0]?.id,
  groups,
  labels: {},
  roles: [],
  entitlements: [],
  scopes: [],
});

const isRetryableStatus = (status: number): boolean => status >= 500 || status === 429;

const resolveFetch = (provided?: FetchLike): FetchLike => {
  if (provided) {
    return provided;
  }

  const candidate = (globalThis as { fetch?: unknown }).fetch;
  if (typeof candidate === "function") {
    return async (input, init) => {
      const response = await (candidate as (
        url: string,
        init?: Record<string, unknown>,
      ) => Promise<unknown>)(input, init as Record<string, unknown> | undefined);

      if (!response || typeof response !== "object") {
        throw new Error("Fetch implementation returned an invalid response");
      }

      const typed = response as {
        ok?: unknown;
        status?: unknown;
        text?: () => Promise<string>;
      } & Record<string, unknown>;

      if (typeof typed.text !== "function") {
        throw new Error("Fetch implementation must expose a text() method");
      }

      const ok = Boolean(typed.ok);
      const status = typeof typed.status === "number" ? typed.status : 0;
      const headers =
        "headers" in typed &&
        typed.headers &&
        typeof (typed.headers as { get?: unknown }).get === "function"
          ? (typed.headers as { get(name: string): string | null })
          : {
              get: () => null,
            };

      return {
        ok,
        status,
        headers,
        text: () => typed.text!.call(response as unknown),
      };
    };
  }

  throw new Error(
    "No fetch implementation available. Provide options.fetch when creating AuthentikClient.",
  );
};

export class AuthentikClient implements IdpAdapterPort {
  private readonly fetch: FetchLike;

  private readonly baseUrl: string;

  private readonly clientId: string;

  private readonly clientSecret?: string;

  private readonly routes: AuthentikRoutes;

  private readonly adminTokenProvider: () => Promise<string>;

  private readonly clock: Clock;

  private readonly identityMapper: IdentityMapper;

  private readonly defaultScopes: ReadonlyArray<string>;

  constructor(options: AuthentikClientOptions) {
    this.baseUrl = options.baseUrl;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.fetch = resolveFetch(options.fetch);
    this.routes = {
      tokenPath: options.routes?.tokenPath ?? DEFAULT_ROUTES.tokenPath,
      introspectionPath: options.routes?.introspectionPath ?? DEFAULT_ROUTES.introspectionPath,
      userPath: options.routes?.userPath ?? DEFAULT_ROUTES.userPath,
      sessionsPath: options.routes?.sessionsPath ?? DEFAULT_ROUTES.sessionsPath,
      groupsPath: options.routes?.groupsPath ?? DEFAULT_ROUTES.groupsPath,
    };
    this.adminTokenProvider = options.adminTokenProvider;
    this.clock = options.clock ?? defaultClock;
    this.identityMapper = options.identityMapper ?? defaultIdentityMapper;
    this.defaultScopes = options.defaultScopes ?? [];
  }

  async exchangeCodeForTokens(
    request: TokenExchangeRequest,
  ): Promise<Result<TokenPair>> {
    const form: Record<string, string> = {
      grant_type: "authorization_code",
      code: request.code,
      redirect_uri: request.redirectUri,
      client_id: request.clientId,
    };

    if (request.codeVerifier) {
      form.code_verifier = request.codeVerifier;
    }

    if (this.clientSecret) {
      form.client_secret = this.clientSecret;
    }

    if (this.defaultScopes.length > 0) {
      form.scope = this.defaultScopes.join(" ");
    }

    const response = await this.request(
      this.routes.tokenPath,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(form).toString(),
      },
      "exchanging authorization code for tokens",
    );

    if (!response.ok) {
      return response;
    }

    return this.mapTokenResponse(response.value, "authorization code exchange");
  }

  async refreshTokens(
    request: TokenRefreshRequest,
  ): Promise<Result<TokenPair>> {
    const form: Record<string, string> = {
      grant_type: "refresh_token",
      refresh_token: request.refreshToken,
      client_id: request.clientId,
    };

    if (this.clientSecret) {
      form.client_secret = this.clientSecret;
    }

    const response = await this.request(
      this.routes.tokenPath,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(form).toString(),
      },
      "refreshing tokens",
    );

    if (!response.ok) {
      return response;
    }

    return this.mapTokenResponse(response.value, "token refresh");
  }

  async validateAccessToken(token: string): Promise<Result<TokenValidationResult>> {
    const form: Record<string, string> = {
      token,
      client_id: this.clientId,
    };

    if (this.clientSecret) {
      form.client_secret = this.clientSecret;
    }

    const response = await this.request(
      this.routes.introspectionPath,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(form).toString(),
      },
      "validating access token",
    );

    if (!response.ok) {
      return response;
    }

    return this.mapIntrospectionResponse(response.value);
  }

  async fetchUserProfile(userId: string): Promise<Result<IdpUserProfile>> {
    const headersResult = await this.buildAdminHeaders();
    if (!headersResult.ok) {
      return headersResult;
    }

    const response = await this.request(
      this.routes.userPath(userId),
      {
        method: "GET",
        headers: headersResult.value,
      },
      "fetching user profile",
    );

    if (!response.ok) {
      return response;
    }

    return this.mapUserProfile(response.value);
  }

  async listActiveSessions(
    userId: string,
  ): Promise<Result<ReadonlyArray<SessionDescriptor>>> {
    const headersResult = await this.buildAdminHeaders();
    if (!headersResult.ok) {
      return headersResult;
    }

    const response = await this.request(
      this.routes.sessionsPath(userId),
      {
        method: "GET",
        headers: headersResult.value,
      },
      "listing user sessions",
    );

    if (!response.ok) {
      return response;
    }

    return this.mapSessions(response.value, userId);
  }

  async buildEffectiveIdentity(
    userId: string,
    orgId?: string,
  ): Promise<Result<EffectiveIdentity>> {
    const profileResult = await this.fetchUserProfile(userId);
    if (!profileResult.ok) {
      return profileResult;
    }

    const [sessionsResult, groupsResult] = await Promise.all([
      this.listActiveSessions(userId),
      this.fetchGroups(userId),
    ]);

    if (!sessionsResult.ok) {
      return sessionsResult;
    }

    const profileGroups = this.extractGroups(profileResult.value);
    let groups = profileGroups;

    if (!groupsResult.ok) {
      const status = this.readHttpStatus(groupsResult.error);
      if (!status || (status !== 404 && status !== 403)) {
        return groupsResult;
      }
    } else {
      groups = Array.from(new Set([...profileGroups, ...groupsResult.value]));
    }

    const identity = this.identityMapper({
      profile: profileResult.value,
      sessions: sessionsResult.value,
      groups,
      orgId,
    });

    return resultOk(identity);
  }

  private async fetchGroups(userId: string): Promise<Result<ReadonlyArray<string>>> {
    const headersResult = await this.buildAdminHeaders();
    if (!headersResult.ok) {
      return headersResult;
    }

    const response = await this.request(
      this.routes.groupsPath(userId),
      {
        method: "GET",
        headers: headersResult.value,
      },
      "fetching user groups",
    );

    if (!response.ok) {
      return resultErr(response.error);
    }

    return this.mapGroups(response.value);
  }

  private async buildAdminHeaders(): Promise<Result<Record<string, string>>> {
    try {
      const token = await this.adminTokenProvider();
      if (!token) {
        return resultErr(
          createInfraError(
            "AUTHENTIK_ADMIN_TOKEN_MISSING",
            "Admin token provider returned an empty token",
            undefined,
            false,
          ),
        );
      }

      return resultOk({
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      });
    } catch (error) {
      return resultErr(unknownError(error, "retrieving Authentik admin token"));
    }
  }

  private async request(
    path: string,
    init: { method: string; headers?: Record<string, string>; body?: string },
    context: string,
  ): Promise<ResultWithBody> {
    const url = toUrl(this.baseUrl, path);

    try {
      const response = await this.fetch(url, {
        method: init.method,
        headers: init.headers ? normaliseHeaders(init.headers) : undefined,
        body: init.body,
      });
      const body = await response.text();
      return resultOk({
        status: response.status,
        ok: response.ok,
        body,
      });
    } catch (error) {
      return resultErr(unknownError(error, context));
    }
  }

  private mapTokenResponse(
    response: ResponseEnvelope,
    context: string,
  ): Result<TokenPair> {
    const { data, error } = safeJsonParse(response.body);
    if (!response.ok) {
      return resultErr(
        createInfraError(
          "AUTHENTIK_TOKEN_ERROR",
          `Authentik returned status ${response.status} during ${context}`,
          {
            status: response.status,
            body: data ?? response.body,
            parseError: error?.message,
          },
          isRetryableStatus(response.status),
        ),
      );
    }

    if (!data || !isRecord(data)) {
      return resultErr(
        createInfraError(
          "AUTHENTIK_TOKEN_PARSE_ERROR",
          `Unexpected token response shape while handling ${context}`,
          {
            body: response.body,
          },
          false,
        ),
      );
    }

    const accessToken = asString(data.access_token);
    const refreshToken = asString(data.refresh_token);
    const expiresAt = this.resolveExpiry(data);

    if (!accessToken || !refreshToken || !expiresAt) {
      return resultErr(
        createInfraError(
          "AUTHENTIK_TOKEN_RESPONSE_INCOMPLETE",
          "Token response missing required fields",
          {
            body: data,
          },
          false,
        ),
      );
    }

    return resultOk({
      accessToken,
      refreshToken,
      expiresAt,
    });
  }

  private mapIntrospectionResponse(
    response: ResponseEnvelope,
  ): Result<TokenValidationResult> {
    const { data, error } = safeJsonParse(response.body);
    if (!response.ok) {
      return resultErr(
        createInfraError(
          "AUTHENTIK_INTROSPECTION_ERROR",
          `Authentik returned status ${response.status} during token validation`,
          {
            status: response.status,
            body: data ?? response.body,
            parseError: error?.message,
          },
          isRetryableStatus(response.status),
        ),
      );
    }

    if (!isRecord(data)) {
      return resultErr(
        createInfraError(
          "AUTHENTIK_INTROSPECTION_PARSE_ERROR",
          "Unexpected introspection response shape",
          {
            body: response.body,
          },
          false,
        ),
      );
    }

    const active = Boolean(data.active);
    const subject = asString(data.sub) ?? asString(data.subject);
    const expires =
      typeof data.exp === "number"
        ? new Date(data.exp * 1000).toISOString()
        : asIsoString(data.expires_at);

    const claims = isRecord(data)
      ? Object.fromEntries(Object.entries(data).filter(([key]) => !["active", "exp"].includes(key)))
      : undefined;

    return resultOk({
      active,
      subject: subject ?? undefined,
      claims,
      expiresAt: expires,
    });
  }

  private mapUserProfile(
    response: ResponseEnvelope,
  ): Result<IdpUserProfile> {
    const { data, error } = safeJsonParse(response.body);
    if (!response.ok) {
      return resultErr(
        createInfraError(
          "AUTHENTIK_PROFILE_ERROR",
          `Authentik returned status ${response.status} when fetching user profile`,
          {
            status: response.status,
            body: data ?? response.body,
            parseError: error?.message,
          },
          isRetryableStatus(response.status),
        ),
      );
    }

    if (!isRecord(data)) {
      return resultErr(
        createInfraError(
          "AUTHENTIK_PROFILE_PARSE_ERROR",
          "Unexpected user profile payload",
          {
            body: response.body,
          },
          false,
        ),
      );
    }

    const id = asString(data.uuid) ?? asString(data.pk) ?? asString(data.id);
    const email =
      asString(data.email) ??
      asString(data.username) ??
      asString(data.primary_email);
    const displayName =
      asString(data.name) ??
      asString(data.display_name) ??
      asString(data.full_name);

    if (!id || !email) {
      return resultErr(
        createDomainError(
          "AUTHENTIK_PROFILE_INCOMPLETE",
          "User profile missing id or email",
          {
            body: data,
          },
        ),
      );
    }

    const authentikMeta = { ...data } as Record<string, unknown>;

    return resultOk({
      id,
      email,
      displayName: displayName ?? undefined,
      authentikMeta,
    });
  }

  private mapSessions(
    response: ResponseEnvelope,
    userId: string,
  ): Result<ReadonlyArray<SessionDescriptor>> {
    const { data, error } = safeJsonParse(response.body);
    if (!response.ok) {
      return resultErr(
        createInfraError(
          "AUTHENTIK_SESSIONS_ERROR",
          `Authentik returned status ${response.status} when listing sessions`,
          {
            status: response.status,
            body: data ?? response.body,
            parseError: error?.message,
          },
          isRetryableStatus(response.status),
        ),
      );
    }

    const sessionsPayload = this.extractSessionsPayload(data);
    const sessions = sessionsPayload
      .map((session) => this.mapSessionDescriptor(session, userId))
      .filter((value): value is SessionDescriptor => value !== undefined);

    return resultOk(sessions);
  }

  private mapGroups(response: ResponseEnvelope): Result<ReadonlyArray<string>> {
    const { data, error } = safeJsonParse(response.body);
    if (!response.ok) {
      return resultErr(
        createInfraError(
          "AUTHENTIK_GROUPS_ERROR",
          `Authentik returned status ${response.status} when fetching groups`,
          {
            status: response.status,
            body: data ?? response.body,
            parseError: error?.message,
          },
          isRetryableStatus(response.status),
        ),
      );
    }

    if (error) {
      return resultErr(
        createInfraError(
          "AUTHENTIK_GROUPS_PARSE_ERROR",
          "Failed to parse group listing response",
          {
            body: response.body,
            parseError: error.message,
          },
          false,
        ),
      );
    }

    const result = new Set<string>();
    if (Array.isArray(data)) {
      for (const entry of data) {
        this.collectGroupNames(entry, result);
      }
    } else if (isRecord(data) && Array.isArray(data.results)) {
      for (const entry of data.results) {
        this.collectGroupNames(entry, result);
      }
    } else if (data) {
      this.collectGroupNames(data, result);
    }

    return resultOk(Array.from(result));
  }

  private extractSessionsPayload(data: unknown): ReadonlyArray<unknown> {
    if (Array.isArray(data)) {
      return data;
    }

    if (isRecord(data) && Array.isArray(data.results)) {
      return data.results;
    }

    return [];
  }

  private mapSessionDescriptor(
    session: unknown,
    fallbackUserId: string,
  ): SessionDescriptor | undefined {
    if (!isRecord(session)) {
      return undefined;
    }

    const id =
      asString(session.uuid) ??
      asString(session.pk) ??
      asString(session.identifier) ??
      asString(session.id);

    if (!id) {
      return undefined;
    }

    const userId =
      asString(session.user) ??
      asString(session.user_uuid) ??
      (isRecord(session.user_obj) ? asString(session.user_obj.uuid) : undefined) ??
      fallbackUserId;

    const createdAt =
      asIsoString(session.created) ??
      asIsoString(session.created_at) ??
      asIsoString(session.start) ??
      this.clock.now().toISOString();

    const lastSeenAt =
      asIsoString(session.last_seen) ??
      asIsoString(session.last_seen_at) ??
      asIsoString(session.updated_at) ??
      createdAt;

    const primaryFactors = asStringArray(session.factors);
    const secondaryFactors = asStringArray(session.authenticated_methods);
    const factors = primaryFactors.length > 0 ? primaryFactors : secondaryFactors;

    const metadata: Record<string, unknown> = {};
    if ("ip" in session && typeof session.ip === "string") {
      metadata.ip = session.ip;
    }
    if ("user_agent" in session && typeof session.user_agent === "string") {
      metadata.userAgent = session.user_agent;
    }
    if ("device" in session && typeof session.device === "string") {
      metadata.device = session.device;
    }

    return {
      id,
      userId,
      createdAt,
      lastSeenAt,
      factorsVerified: factors,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    };
  }

  private extractGroups(profile: IdpUserProfile): ReadonlyArray<string> {
    const meta = profile.authentikMeta;
    if (!meta || typeof meta !== "object") {
      return [];
    }

    const buckets = [
      (meta as Record<string, unknown>).groups,
      (meta as Record<string, unknown>).groups_obj,
      (meta as Record<string, unknown>).group_memberships,
      (meta as Record<string, unknown>).memberships,
    ];

    const result = new Set<string>();
    for (const bucket of buckets) {
      this.collectGroupNames(bucket, result);
    }

    return Array.from(result);
  }

  private collectGroupNames(input: unknown, result: Set<string>): void {
    if (!input) {
      return;
    }

    if (typeof input === "string") {
      result.add(input);
      return;
    }

    if (Array.isArray(input)) {
      for (const item of input) {
        this.collectGroupNames(item, result);
      }
      return;
    }

    if (isRecord(input)) {
      if (typeof input.name === "string") {
        result.add(input.name);
      }
      if (typeof input.slug === "string") {
        result.add(input.slug);
      }
      if ("group" in input) {
        this.collectGroupNames(input.group, result);
      }
    }
  }

  private resolveExpiry(data: Record<string, unknown>): string | undefined {
    const direct = asIsoString(data.expires_at);
    if (direct) {
      return direct;
    }

    const expiresInRaw = data.expires_in;
    const expiresIn =
      typeof expiresInRaw === "number"
        ? expiresInRaw
        : typeof expiresInRaw === "string"
          ? Number.parseInt(expiresInRaw, 10)
          : undefined;

    if (typeof expiresIn === "number" && Number.isFinite(expiresIn)) {
      return new Date(this.clock.now().getTime() + expiresIn * 1000).toISOString();
    }

    return undefined;
  }

  private readHttpStatus(error: CatalystError): number | undefined {
    if (error.details && typeof error.details.status === "number") {
      return error.details.status;
    }
    return undefined;
  }
}

type ResultWithBody = Result<ResponseEnvelope>;
