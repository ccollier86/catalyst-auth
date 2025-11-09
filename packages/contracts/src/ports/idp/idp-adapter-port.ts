import type { Result } from "../../types/result.js";
import type { CatalystError } from "../../types/domain-error.js";
import type { EffectiveIdentity } from "../../types/identity.js";
import type { TokenPair } from "../../types/token.js";

export interface TokenExchangeRequest {
  readonly code: string;
  readonly codeVerifier?: string;
  readonly redirectUri: string;
  readonly clientId: string;
}

export interface TokenRefreshRequest {
  readonly refreshToken: string;
  readonly clientId: string;
}

export interface TokenValidationResult {
  readonly active: boolean;
  readonly subject?: string;
  readonly claims?: Record<string, unknown>;
  readonly expiresAt?: string;
}

export interface SessionDescriptor {
  readonly id: string;
  readonly userId: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly factorsVerified: ReadonlyArray<string>;
  readonly metadata?: Record<string, unknown>;
}

export interface IdpUserProfile {
  readonly id: string;
  readonly email: string;
  readonly displayName?: string;
  readonly authentikMeta: Record<string, unknown>;
}

export interface IdpAdapterPort {
  exchangeCodeForTokens(request: TokenExchangeRequest): Promise<Result<TokenPair, CatalystError>>;
  refreshTokens(request: TokenRefreshRequest): Promise<Result<TokenPair, CatalystError>>;
  validateAccessToken(token: string): Promise<Result<TokenValidationResult, CatalystError>>;
  fetchUserProfile(userId: string): Promise<Result<IdpUserProfile, CatalystError>>;
  listActiveSessions(userId: string): Promise<Result<ReadonlyArray<SessionDescriptor>, CatalystError>>;
  buildEffectiveIdentity(userId: string, orgId?: string): Promise<Result<EffectiveIdentity, CatalystError>>;
}
