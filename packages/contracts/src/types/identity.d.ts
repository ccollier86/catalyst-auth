export type LabelValue = string | number | boolean;
export interface LabelSet {
    readonly [label: string]: LabelValue;
}
export interface EffectiveIdentity {
    readonly userId: string;
    readonly orgId?: string;
    readonly sessionId?: string;
    readonly groups: ReadonlyArray<string>;
    readonly labels: LabelSet;
    readonly roles: ReadonlyArray<string>;
    readonly entitlements: ReadonlyArray<string>;
    readonly scopes: ReadonlyArray<string>;
}
export interface IdentityContext extends EffectiveIdentity {
    readonly decisionJwt?: string;
}
//# sourceMappingURL=identity.d.ts.map