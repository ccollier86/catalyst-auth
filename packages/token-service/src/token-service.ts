import { createPrivateKey, createSign, randomUUID, sign as nodeSign, type KeyObject } from "node:crypto";

import {
  err,
  ok,
  type JwtDescriptor,
  type MintDecisionJwtInput,
  type Result,
  type TokenServicePort,
} from "@catalyst-auth/contracts";

import type {
  DecisionTokenOptions,
  SupportedTokenAlgorithm,
  TokenServiceOptions,
  TokenSignerConfig,
} from "./types.js";

const DEFAULT_DECISION_TTL_SECONDS = 55;

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

export class TokenService implements TokenServicePort {
  private readonly issuer: string;
  private readonly decision: NormalizedDecisionConfig;
  private readonly now: () => Date;
  private readonly jtiFactory: () => string;

  constructor(options: TokenServiceOptions) {
    if (!options.issuer || options.issuer.trim().length === 0) {
      throw new Error("TokenService requires a non-empty issuer");
    }
    if (!options.decision) {
      throw new Error("TokenService requires decision token configuration");
    }

    this.issuer = options.issuer;
    this.decision = normalizeDecisionOptions(options.decision);
    this.now = options.now ?? (() => new Date());
    this.jtiFactory = options.jtiFactory ?? randomUUID;
  }

  async mintDecisionJwt(input: MintDecisionJwtInput): Promise<Result<JwtDescriptor>> {
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

    const header: Record<string, unknown> = {
      alg: this.decision.signer.algorithm,
      typ: "JWT",
    };

    if (this.decision.signer.keyId) {
      header.kid = this.decision.signer.keyId;
    }

    try {
      const token = signJwt(header, payload, this.decision.signer);
      return ok({
        token,
        expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
      });
    } catch (error) {
      return err({
        code: "token.sign_failed",
        message: "Failed to sign decision JWT",
        details: {
          cause: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
}

export const createTokenService = (options: TokenServiceOptions): TokenServicePort =>
  new TokenService(options);

const normalizeDecisionOptions = (options: DecisionTokenOptions): NormalizedDecisionConfig => ({
  signer: normalizeSigner(options.signer),
  audience: options.audience,
  defaultTtlSeconds: Math.max(1, options.defaultTtlSeconds ?? DEFAULT_DECISION_TTL_SECONDS),
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
