import type { LabelSet } from "./identity.js";
export type KeyOwnerKind = "user" | "org" | "service" | "system";
export interface KeyActorReference {
    readonly kind: KeyOwnerKind;
    readonly id: string;
}
export interface KeyOwnerReference extends KeyActorReference {
}
export type KeyStatus = "active" | "revoked" | "expired";
export interface KeyRecord {
    readonly id: string;
    readonly hash: string;
    readonly name?: string;
    readonly description?: string;
    readonly owner: KeyOwnerReference;
    readonly createdBy?: KeyActorReference;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly expiresAt?: string;
    readonly lastUsedAt?: string;
    readonly usageCount: number;
    readonly status: KeyStatus;
    readonly scopes: ReadonlyArray<string>;
    readonly labels: LabelSet;
    readonly metadata?: Record<string, unknown>;
    readonly revokedAt?: string;
    readonly revokedBy?: KeyActorReference;
    readonly revocationReason?: string;
}
export interface IssueKeyInput {
    readonly id?: string;
    readonly hash: string;
    readonly owner: KeyOwnerReference;
    readonly name?: string;
    readonly description?: string;
    readonly createdBy?: KeyActorReference;
    readonly scopes: ReadonlyArray<string>;
    readonly labels?: LabelSet;
    readonly expiresAt?: string;
    readonly createdAt?: string;
    readonly metadata?: Record<string, unknown>;
}
export interface ListKeysOptions {
    readonly includeRevoked?: boolean;
    readonly includeExpired?: boolean;
}
export interface KeyUsageOptions {
    readonly usedAt?: string;
}
export interface RevokeKeyInput {
    readonly revokedAt?: string;
    readonly revokedBy?: KeyActorReference;
    readonly reason?: string;
}
//# sourceMappingURL=key.d.ts.map