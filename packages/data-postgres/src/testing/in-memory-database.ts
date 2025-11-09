import type {
  GroupRecord,
  MembershipRecord,
  OrgProfileRecord,
  UserProfileRecord,
  KeyRecord,
  AuditEventRecord,
} from "@catalyst-auth/contracts";

import { clone } from "../utils/clone.js";

export type StoredMembership = MembershipRecord;
export type StoredGroup = GroupRecord;
export type StoredOrgProfile = OrgProfileRecord;
export type StoredUserProfile = UserProfileRecord;
export type StoredKey = KeyRecord;

export class InMemoryPostgresDatabase {
  readonly users = new Map<string, StoredUserProfile>();
  readonly orgs = new Map<string, StoredOrgProfile>();
  readonly orgSlugIndex = new Map<string, string>();
  readonly groups = new Map<string, StoredGroup>();
  readonly groupsByOrg = new Map<string, Set<string>>();
  readonly memberships = new Map<string, StoredMembership>();
  readonly membershipsByUser = new Map<string, Set<string>>();
  readonly membershipsByOrg = new Map<string, Set<string>>();

  readonly keys = new Map<string, StoredKey>();
  readonly keyHashIndex = new Map<string, string>();
  readonly keyOwnerIndex = new Map<string, Set<string>>();

  readonly auditEvents = new Map<string, AuditEventRecord>();

  saveUser(profile: UserProfileRecord): UserProfileRecord {
    const stored = clone(profile);
    this.users.set(profile.id, stored);
    return clone(stored);
  }

  saveOrg(profile: OrgProfileRecord): OrgProfileRecord {
    const stored = clone(profile);
    const existing = this.orgs.get(profile.id);
    if (existing && existing.slug !== profile.slug) {
      this.orgSlugIndex.delete(existing.slug);
    }
    this.orgs.set(profile.id, stored);
    this.orgSlugIndex.set(profile.slug, profile.id);
    return clone(stored);
  }

  saveGroup(group: GroupRecord): GroupRecord {
    const stored = clone(group);
    const existing = this.groups.get(group.id);
    if (existing && existing.orgId !== group.orgId) {
      this.unlinkGroupFromOrg(existing.id, existing.orgId);
    }
    this.groups.set(group.id, stored);
    this.linkGroupToOrg(group.id, group.orgId);
    return clone(stored);
  }

  deleteGroup(groupId: string): void {
    const existing = this.groups.get(groupId);
    if (!existing) {
      return;
    }
    this.groups.delete(groupId);
    this.unlinkGroupFromOrg(existing.id, existing.orgId);
    this.removeGroupFromMemberships(groupId, existing.orgId);
  }

  saveMembership(membership: MembershipRecord): MembershipRecord {
    const stored = clone(membership);
    const existing = this.memberships.get(membership.id);
    if (existing) {
      this.unlinkMembership(existing);
    }
    this.memberships.set(membership.id, stored);
    this.linkMembership(stored);
    return clone(stored);
  }

  deleteMembership(id: string): void {
    const existing = this.memberships.get(id);
    if (!existing) {
      return;
    }
    this.memberships.delete(id);
    this.unlinkMembership(existing);
  }

  saveKey(key: KeyRecord): KeyRecord {
    const stored = clone(key);
    this.keys.set(key.id, stored);
    this.keyHashIndex.set(key.hash, key.id);
    const ownerKey = `${key.owner.kind}:${key.owner.id}`;
    let keysForOwner = this.keyOwnerIndex.get(ownerKey);
    if (!keysForOwner) {
      keysForOwner = new Set();
      this.keyOwnerIndex.set(ownerKey, keysForOwner);
    }
    keysForOwner.add(key.id);
    return clone(stored);
  }

  removeKey(keyId: string): void {
    const existing = this.keys.get(keyId);
    if (!existing) {
      return;
    }
    this.keys.delete(keyId);
    this.keyHashIndex.delete(existing.hash);
    const ownerKey = `${existing.owner.kind}:${existing.owner.id}`;
    const keysForOwner = this.keyOwnerIndex.get(ownerKey);
    if (keysForOwner) {
      keysForOwner.delete(keyId);
      if (keysForOwner.size === 0) {
        this.keyOwnerIndex.delete(ownerKey);
      }
    }
  }

  recordAuditEvent(event: AuditEventRecord): AuditEventRecord {
    const stored = clone(event);
    this.auditEvents.set(event.id, stored);
    return clone(stored);
  }

  private linkGroupToOrg(groupId: string, orgId: string): void {
    let groups = this.groupsByOrg.get(orgId);
    if (!groups) {
      groups = new Set();
      this.groupsByOrg.set(orgId, groups);
    }
    groups.add(groupId);
  }

  private unlinkGroupFromOrg(groupId: string, orgId: string): void {
    const groups = this.groupsByOrg.get(orgId);
    if (!groups) {
      return;
    }
    groups.delete(groupId);
    if (groups.size === 0) {
      this.groupsByOrg.delete(orgId);
    }
  }

  private removeGroupFromMemberships(groupId: string, orgId: string): void {
    const membershipIds = this.membershipsByOrg.get(orgId);
    if (!membershipIds) {
      return;
    }
    for (const membershipId of membershipIds) {
      const membership = this.memberships.get(membershipId);
      if (!membership) {
        continue;
      }
      if (!membership.groupIds.includes(groupId)) {
        continue;
      }
      const updated: MembershipRecord = {
        ...membership,
        groupIds: membership.groupIds.filter((id) => id !== groupId),
      };
      this.memberships.set(membershipId, updated);
    }
  }

  private linkMembership(membership: MembershipRecord): void {
    this.addToIndex(this.membershipsByUser, membership.userId, membership.id);
    this.addToIndex(this.membershipsByOrg, membership.orgId, membership.id);
  }

  private unlinkMembership(membership: MembershipRecord): void {
    this.removeFromIndex(this.membershipsByUser, membership.userId, membership.id);
    this.removeFromIndex(this.membershipsByOrg, membership.orgId, membership.id);
  }

  private addToIndex(index: Map<string, Set<string>>, key: string, value: string): void {
    let bucket = index.get(key);
    if (!bucket) {
      bucket = new Set();
      index.set(key, bucket);
    }
    bucket.add(value);
  }

  private removeFromIndex(index: Map<string, Set<string>>, key: string, value: string): void {
    const bucket = index.get(key);
    if (!bucket) {
      return;
    }
    bucket.delete(value);
    if (bucket.size === 0) {
      index.delete(key);
    }
  }
}
