import type {
  CatalystError,
  EffectiveIdentity,
  IdpAdapterPort,
  IdpUserProfile,
  Result,
  SessionDescriptor,
  TokenExchangeRequest,
  TokenPair,
  TokenRefreshRequest,
  TokenValidationResult,
} from "@catalyst-auth/contracts";
import { ok } from "@catalyst-auth/contracts";

const nowIso = () => new Date().toISOString();

const sessions: SessionDescriptor[] = [
  {
    id: "session-demo",
    userId: "user-1",
    createdAt: nowIso(),
    lastSeenAt: nowIso(),
    factorsVerified: ["password"],
  },
];

const tokenPair: TokenPair = {
  accessToken: "demo-access-token",
  refreshToken: "demo-refresh-token",
  expiresAt: nowIso(),
};

export const authentikAdapter: IdpAdapterPort = {
  async exchangeCodeForTokens(_request: TokenExchangeRequest): Promise<Result<TokenPair, CatalystError>> {
    return ok(tokenPair);
  },
  async refreshTokens(_request: TokenRefreshRequest): Promise<Result<TokenPair, CatalystError>> {
    return ok(tokenPair);
  },
  async validateAccessToken(_token: string): Promise<Result<TokenValidationResult, CatalystError>> {
    return ok({ active: true, subject: "user-1" });
  },
  async fetchUserProfile(_userId: string): Promise<Result<IdpUserProfile, CatalystError>> {
    return ok({ id: "user-1", email: "user@example.com", authentikMeta: {} });
  },
  async listActiveSessions(_userId: string): Promise<Result<ReadonlyArray<SessionDescriptor>, CatalystError>> {
    return ok(sessions);
  },
  async buildEffectiveIdentity(userId: string, orgId?: string): Promise<Result<EffectiveIdentity, CatalystError>> {
    const identity: EffectiveIdentity = {
      userId,
      orgId,
      sessionId: "session-demo",
      groups: [],
      labels: {},
      roles: ["member"],
      entitlements: [],
      scopes: ["openid"],
    };
    return ok(identity);
  },
};
