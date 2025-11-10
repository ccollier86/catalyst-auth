import type { EffectiveIdentity, LabelSet } from "./identity.js";
export interface JwtDescriptor {
    readonly token: string;
    readonly expiresAt: string;
}
export interface TokenPair {
    readonly accessToken: string;
    readonly refreshToken: string;
    readonly expiresAt: string;
}
export interface DecisionResourceClaims {
    readonly type?: string;
    readonly id?: string;
    readonly labels?: LabelSet;
}
export interface DecisionTokenClaims {
    readonly iss: string;
    readonly sub: string;
    readonly org?: string;
    readonly session?: string;
    readonly action: string;
    readonly groups: ReadonlyArray<string>;
    readonly roles: ReadonlyArray<string>;
    readonly entitlements: ReadonlyArray<string>;
    readonly scopes: ReadonlyArray<string>;
    readonly labels: LabelSet;
    readonly token_type: "decision";
    readonly iat: number;
    readonly exp: number;
    readonly jti: string;
    readonly resource?: DecisionResourceClaims;
    readonly environment?: Record<string, unknown>;
    readonly aud?: string | ReadonlyArray<string>;
}
export interface MintDecisionJwtInput {
    readonly identity: EffectiveIdentity;
    readonly action: string;
    readonly resource?: DecisionResourceClaims;
    readonly environment?: Record<string, unknown>;
    readonly audience?: string | ReadonlyArray<string>;
    readonly ttlSeconds?: number;
}
export interface MintAccessTokenInput {
    readonly subject: string;
    readonly clientId: string;
    readonly scopes: ReadonlyArray<string>;
    readonly orgId?: string;
    readonly sessionId?: string;
    readonly audience?: string | ReadonlyArray<string>;
    readonly ttlSeconds?: number;
    readonly metadata?: Record<string, unknown>;
}
export interface MintRefreshTokenInput {
    readonly subject: string;
    readonly clientId: string;
    readonly sessionId?: string;
    readonly ttlSeconds?: number;
    readonly metadata?: Record<string, unknown>;
}
//# sourceMappingURL=token.d.ts.map