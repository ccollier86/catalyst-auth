import type { EffectiveIdentity, LabelSet } from "../../types/identity.js";
export type OrgStatus = "active" | "suspended" | "invited" | "archived";
export interface UserProfileRecord {
    readonly id: string;
    readonly authentikId: string;
    readonly email: string;
    readonly primaryOrgId?: string;
    readonly displayName?: string;
    readonly avatarUrl?: string;
    readonly labels: LabelSet;
    readonly metadata?: Record<string, unknown>;
}
export interface OrgProfileRecord {
    readonly id: string;
    readonly slug: string;
    readonly status: OrgStatus;
    readonly ownerUserId: string;
    readonly profile: {
        readonly name: string;
        readonly logoUrl?: string;
        readonly description?: string;
        readonly websiteUrl?: string;
        readonly brandColors?: LabelSet;
        readonly address?: Record<string, unknown>;
        readonly links?: Record<string, string>;
    };
    readonly labels: LabelSet;
    readonly settings: Record<string, unknown>;
}
export interface MembershipRecord {
    readonly id: string;
    readonly userId: string;
    readonly orgId: string;
    readonly role: string;
    readonly groupIds: ReadonlyArray<string>;
    readonly labelsDelta: LabelSet;
    readonly createdAt: string;
    readonly updatedAt: string;
}
export interface GroupRecord {
    readonly id: string;
    readonly orgId: string;
    readonly slug: string;
    readonly name: string;
    readonly description?: string;
    readonly parentGroupId?: string;
    readonly labels: LabelSet;
}
export interface EffectiveIdentityRequest {
    readonly userId: string;
    readonly orgId?: string;
    readonly membershipId?: string;
    readonly includeGroups?: boolean;
}
export interface ProfileStorePort {
    getUserProfile(id: string): Promise<UserProfileRecord | undefined>;
    upsertUserProfile(profile: UserProfileRecord): Promise<UserProfileRecord>;
    getOrgProfile(id: string): Promise<OrgProfileRecord | undefined>;
    getOrgProfileBySlug(slug: string): Promise<OrgProfileRecord | undefined>;
    upsertOrgProfile(profile: OrgProfileRecord): Promise<OrgProfileRecord>;
    listGroups(orgId: string): Promise<ReadonlyArray<GroupRecord>>;
    upsertGroup(group: GroupRecord): Promise<GroupRecord>;
    deleteGroup(groupId: string): Promise<void>;
    listMembershipsByUser(userId: string): Promise<ReadonlyArray<MembershipRecord>>;
    listMembershipsByOrg(orgId: string): Promise<ReadonlyArray<MembershipRecord>>;
    upsertMembership(membership: MembershipRecord): Promise<MembershipRecord>;
    removeMembership(membershipId: string): Promise<void>;
    computeEffectiveIdentity(request: EffectiveIdentityRequest): Promise<EffectiveIdentity>;
}
//# sourceMappingURL=profile-store-port.d.ts.map