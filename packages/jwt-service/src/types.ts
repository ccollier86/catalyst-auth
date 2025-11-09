import type { KeyObject } from "node:crypto";

export type SupportedTokenAlgorithm = "RS256" | "EdDSA";

export interface TokenSignerConfig {
  readonly algorithm: SupportedTokenAlgorithm;
  readonly privateKey: string | Buffer | KeyObject;
  readonly keyId?: string;
}

export interface DecisionTokenOptions {
  readonly signer: TokenSignerConfig;
  readonly audience?: string | ReadonlyArray<string>;
  readonly defaultTtlSeconds?: number;
}

export interface AccessTokenOptions {
  readonly signer: TokenSignerConfig;
  readonly audience?: string | ReadonlyArray<string>;
  readonly defaultTtlSeconds?: number;
  readonly scopeClaim?: "scope" | "scopes";
}

export interface RefreshTokenOptions {
  readonly signer: TokenSignerConfig;
  readonly defaultTtlSeconds?: number;
}

export interface JwtServiceOptions {
  readonly issuer: string;
  readonly decision?: DecisionTokenOptions;
  readonly access?: AccessTokenOptions;
  readonly refresh?: RefreshTokenOptions;
  readonly now?: () => Date;
  readonly jtiFactory?: () => string;
}
