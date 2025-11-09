import { createPrivateKey, createSign, randomUUID, sign as nodeSign, type KeyObject } from "node:crypto";

import {
  err,
  ok,
  type CatalystError,
  type JwtDescriptor,
  type MintAccessTokenInput,
  type MintDecisionJwtInput,
  type MintRefreshTokenInput,
  type Result,
  type TokenPair,
  type TokenServicePort,
} from "@catalyst-auth/contracts";

import type {
  AccessTokenOptions,
  DecisionTokenOptions,
  JwtServiceOptions,
  RefreshTokenOptions,
  SupportedTokenAlgorithm,
  TokenSignerConfig,
} from "./types.js";

const DEFAULT_DECISION_TTL_SECONDS = 55;
const DEFAULT_ACCESS_TTL_SECONDS = 900;
const DEFAULT_REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

interface NormalizedSignerConfig {
  readonly algorithm: SupportedTokenAlgorithm;
  readonly key: KeyObject;
  readonly keyId?: string;
}

interface NormalizedDecisionConfig {
  readonly signer: NormalizedSignerConfig;
  readonly audience?: string | ReadonlyArray<string>;
  readonly defaultTtlSeconds: number;
}

interface NormalizedAccessConfig {
  readonly signer: NormalizedSignerConfig;
  readonly audience?: string | ReadonlyArray<string>;
  readonly defaultTtlSeconds: number;
  readonly scopeClaim: "scope" | "scopes";
}

interface NormalizedRefreshConfig {
  readonly signer: NormalizedSignerConfig;
  readonly defaultTtlSeconds: number;
}

export class JwtService implements TokenServicePort {
  private readonly issuer: string;
  private readonly decision?: NormalizedDecisionConfig;
  private readonly access?: NormalizedAccessConfig;
  private readonly refresh?: NormalizedRefreshConfig;
  private readonly now: () => Date;
  private readonly jtiFactory: () => string;

  constructor(options: JwtServiceOptions) {
    if (!options.issuer || options.issuer.trim().length === 0) {
      throw new Error("JwtService requires a non-empty issuer");
    }

    this.issuer = options.issuer;
    this.decision = options.decision ? normalizeDecisionOptions(options.decision) : undefined;
    this.access = options.access ? normalizeAccessOptions(options.access) : undefined;
    this.refresh = options.refresh ? normalizeRefreshOptions(options.refresh) : undefined;
    this.now = options.now ?? (() => new Date());
    this.jtiFactory = options.jtiFactory ?? randomUUID;

    if (!this.decision) {
      throw new Error("JwtService requires decision token configuration");
    }
  }

  async mintDecisionJwt(input: MintDecisionJwtInput): Promise<Result<JwtDescriptor, CatalystError>> {
    if (!this.decision) {
      return err(createError("token.decision.unsupported", "Decision token minting is not configured"));
    }

    const action = input.action.trim();
    if (!action) {
      return err({
        code: "token.invalid_action",
        message: "Action is required to mint decision JWTs",
      });
    }

    const issuedAt = Math.floor(this.now().getTime() / 1000);
    const ttlSeconds = Math.max(1, input.ttlSeconds ?? this.decision.defaultTtlSeconds);
    const expiresAtSeconds = issuedAt + ttlSeconds;
    const audience = input.audience ?? this.decision.audience;

    const payload: Record<string, unknown> = {
      iss: this.issuer,
      sub: input.identity.userId,
      iat: issuedAt,
      exp: expiresAtSeconds,
      jti: this.jtiFactory(),
      token_type: "decision",
      action,
      org: input.identity.orgId,
      session: input.identity.sessionId,
      groups: [...input.identity.groups],
      roles: [...input.identity.roles],
      entitlements: [...input.identity.entitlements],
      scopes: [...input.identity.scopes],
      labels: cloneRecord(input.identity.labels),
    };

    if (audience) {
      payload.aud = audience;
    }

    if (input.resource) {
      payload.resource = cloneResource(input.resource);
    }

    if (input.environment) {
      payload.environment = cloneRecord(input.environment);
    }

    const header = this.buildHeader(this.decision.signer);

    try {
      const token = signJwt(header, payload, this.decision.signer);
      return ok({
        token,
        expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
      });
    } catch (error) {
      return err(signingError(error));
    }
  }

  async mintAccessToken(input: MintAccessTokenInput): Promise<Result<JwtDescriptor, CatalystError>> {
    if (!this.access) {
      return err(createError("token.access.unsupported", "Access token minting is not configured"));
    }

    const subject = input.subject?.trim();
    if (!subject) {
      return err(createError("token.access.invalid_subject", "Subject is required"));
    }

    const clientId = input.clientId?.trim();
    if (!clientId) {
      return err(createError("token.access.invalid_client", "Client id is required"));
    }

    const issuedAt = Math.floor(this.now().getTime() / 1000);
    const ttlSeconds = Math.max(1, input.ttlSeconds ?? this.access.defaultTtlSeconds);
    const expiresAtSeconds = issuedAt + ttlSeconds;
    const audience = input.audience ?? this.access.audience;

    const payload: Record<string, unknown> = {
      iss: this.issuer,
      sub: subject,
      client_id: clientId,
      token_type: "access",
      iat: issuedAt,
      exp: expiresAtSeconds,
      jti: this.jtiFactory(),
    };

    if (audience) {
      payload.aud = audience;
    }

    if (input.orgId) {
      payload.org = input.orgId;
    }

    if (input.sessionId) {
      payload.session = input.sessionId;
    }

    if (input.scopes.length > 0) {
      if (this.access.scopeClaim === "scopes") {
        payload.scopes = [...input.scopes];
      } else {
        payload.scope = input.scopes.join(" ");
      }
    }

    if (input.metadata) {
      payload.metadata = cloneRecord(input.metadata);
    }

    const header = this.buildHeader(this.access.signer);

    try {
      const token = signJwt(header, payload, this.access.signer);
      return ok({ token, expiresAt: new Date(expiresAtSeconds * 1000).toISOString() });
    } catch (error) {
      return err(signingError(error));
    }
  }

  async mintRefreshToken(input: MintRefreshTokenInput): Promise<Result<JwtDescriptor, CatalystError>> {
    if (!this.refresh) {
      return err(createError("token.refresh.unsupported", "Refresh token minting is not configured"));
    }

    const subject = input.subject?.trim();
    if (!subject) {
      return err(createError("token.refresh.invalid_subject", "Subject is required"));
    }

    const clientId = input.clientId?.trim();
    if (!clientId) {
      return err(createError("token.refresh.invalid_client", "Client id is required"));
    }

    const issuedAt = Math.floor(this.now().getTime() / 1000);
    const ttlSeconds = Math.max(1, input.ttlSeconds ?? this.refresh.defaultTtlSeconds);
    const expiresAtSeconds = issuedAt + ttlSeconds;

    const payload: Record<string, unknown> = {
      iss: this.issuer,
      sub: subject,
      client_id: clientId,
      token_type: "refresh",
      iat: issuedAt,
      exp: expiresAtSeconds,
      jti: this.jtiFactory(),
    };

    if (input.sessionId) {
      payload.session = input.sessionId;
    }

    if (input.metadata) {
      payload.metadata = cloneRecord(input.metadata);
    }

    const header = this.buildHeader(this.refresh.signer);

    try {
      const token = signJwt(header, payload, this.refresh.signer);
      return ok({ token, expiresAt: new Date(expiresAtSeconds * 1000).toISOString() });
    } catch (error) {
      return err(signingError(error));
    }
  }

  async mintTokenPair(
    accessInput: MintAccessTokenInput,
    refreshInput: MintRefreshTokenInput,
  ): Promise<Result<TokenPair, CatalystError>> {
    const accessResult = await this.mintAccessToken(accessInput);
    if (!accessResult.ok) {
      return accessResult;
    }

    const refreshResult = await this.mintRefreshToken(refreshInput);
    if (!refreshResult.ok) {
      return refreshResult;
    }

    return ok({
      accessToken: accessResult.value.token,
      refreshToken: refreshResult.value.token,
      expiresAt: accessResult.value.expiresAt,
    });
  }

  private buildHeader(signer: NormalizedSignerConfig): Record<string, unknown> {
    const header: Record<string, unknown> = {
      alg: signer.algorithm,
      typ: "JWT",
    };

    if (signer.keyId) {
      header.kid = signer.keyId;
    }

    return header;
  }
}

export const createJwtService = (options: JwtServiceOptions): TokenServicePort => new JwtService(options);

const normalizeDecisionOptions = (options: DecisionTokenOptions): NormalizedDecisionConfig => ({
  signer: normalizeSigner(options.signer),
  audience: options.audience,
  defaultTtlSeconds: Math.max(1, options.defaultTtlSeconds ?? DEFAULT_DECISION_TTL_SECONDS),
});

const normalizeAccessOptions = (options: AccessTokenOptions): NormalizedAccessConfig => ({
  signer: normalizeSigner(options.signer),
  audience: options.audience,
  defaultTtlSeconds: Math.max(1, options.defaultTtlSeconds ?? DEFAULT_ACCESS_TTL_SECONDS),
  scopeClaim: options.scopeClaim ?? "scope",
});

const normalizeRefreshOptions = (options: RefreshTokenOptions): NormalizedRefreshConfig => ({
  signer: normalizeSigner(options.signer),
  defaultTtlSeconds: Math.max(1, options.defaultTtlSeconds ?? DEFAULT_REFRESH_TTL_SECONDS),
});

const normalizeSigner = (signer: TokenSignerConfig): NormalizedSignerConfig => ({
  algorithm: signer.algorithm,
  key: toKeyObject(signer.privateKey),
  keyId: signer.keyId,
});

const toKeyObject = (value: TokenSignerConfig["privateKey"]): KeyObject => {
  if (isKeyObject(value)) {
    return value;
  }
  return createPrivateKey(value);
};

const isKeyObject = (value: TokenSignerConfig["privateKey"]): value is KeyObject =>
  typeof value === "object" && value !== null && typeof (value as KeyObject).type === "string";

const signJwt = (
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  signer: NormalizedSignerConfig,
): string => {
  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = signInput(signingInput, signer);
  return `${signingInput}.${signature}`;
};

const signInput = (input: string, signer: NormalizedSignerConfig): string => {
  if (signer.algorithm === "RS256") {
    const signerInstance = createSign("RSA-SHA256");
    signerInstance.update(input);
    signerInstance.end();
    const signature = signerInstance.sign(signer.key);
    return toBase64Url(signature);
  }

  if (signer.algorithm === "EdDSA") {
    const signature = nodeSign(null, Buffer.from(input), signer.key);
    return toBase64Url(signature);
  }

  throw new Error(`Unsupported signing algorithm: ${signer.algorithm}`);
};

const toBase64Url = (input: string | Buffer): string =>
  Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

const cloneRecord = <T extends Record<string, unknown>>(value: T): T => ({
  ...value,
});

const cloneResource = (
  resource: Required<MintDecisionJwtInput>["resource"],
): Record<string, unknown> => ({
  ...(resource.type ? { type: resource.type } : {}),
  ...(resource.id ? { id: resource.id } : {}),
  ...(resource.labels ? { labels: cloneRecord(resource.labels) } : {}),
});

const signingError = (error: unknown): CatalystError => ({
  code: "token.sign_failed",
  message: "Failed to sign JWT",
  details: {
    cause: error instanceof Error ? error.message : String(error),
  },
});

const createError = (code: string, message: string, details?: Record<string, unknown>): CatalystError => ({
  code,
  message,
  details,
});
