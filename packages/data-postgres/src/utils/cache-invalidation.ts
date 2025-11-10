import type { CachePort, EffectiveIdentity } from "@catalyst-auth/contracts";

export interface CacheInvalidationTarget {
  readonly decisionCache?: CachePort;
  readonly effectiveIdentityCache?: CachePort<EffectiveIdentity>;
}

export interface CacheInvalidationContext {
  readonly userId?: string;
  readonly orgId?: string;
  readonly membershipId?: string;
  readonly groupIds?: ReadonlyArray<string>;
}

export class PostgresCacheInvalidator {
  constructor(private readonly targets: CacheInvalidationTarget) {}

  async invalidate(context: CacheInvalidationContext): Promise<void> {
    await Promise.all([
      this.invalidateDecisionCache(context),
      this.invalidateIdentityCache(context),
    ]);
  }

  async invalidateUser(userId: string): Promise<void> {
    await this.invalidate({ userId });
  }

  async invalidateOrg(orgId: string): Promise<void> {
    await this.invalidate({ orgId });
  }

  async invalidateMembership(context: {
    readonly userId: string;
    readonly orgId: string;
    readonly membershipId: string;
    readonly groupIds?: ReadonlyArray<string>;
  }): Promise<void> {
    await this.invalidate({
      userId: context.userId,
      orgId: context.orgId,
      membershipId: context.membershipId,
      groupIds: context.groupIds,
    });
  }

  async invalidateGroups(orgId: string, groupIds: ReadonlyArray<string>): Promise<void> {
    await this.invalidate({ orgId, groupIds });
  }

  private async invalidateDecisionCache(context: CacheInvalidationContext): Promise<void> {
    const cache = this.targets.decisionCache;
    if (!cache) {
      return;
    }

    const tags = new Set<string>();
    if (context.userId) {
      tags.add(`decision:user:${context.userId}`);
    }
    if (context.orgId) {
      tags.add(`decision:org:${context.orgId}`);
    }
    for (const groupId of context.groupIds ?? []) {
      if (groupId) {
        tags.add(`decision:group:${groupId}`);
      }
    }

    await invalidateCache(cache, tags);
  }

  private async invalidateIdentityCache(context: CacheInvalidationContext): Promise<void> {
    const cache = this.targets.effectiveIdentityCache;
    if (!cache) {
      return;
    }

    const tags = new Set<string>();
    if (context.userId) {
      tags.add(`effective-identity:user:${context.userId}`);
    }
    if (context.orgId) {
      tags.add(`effective-identity:org:${context.orgId}`);
    }
    if (context.membershipId) {
      tags.add(`effective-identity:membership:${context.membershipId}`);
    }
    for (const groupId of context.groupIds ?? []) {
      if (groupId) {
        tags.add(`effective-identity:group:${groupId}`);
      }
    }

    await invalidateCache(cache, tags);
  }
}

const invalidateCache = async (
  cache: CachePort,
  tags: ReadonlySet<string>,
): Promise<void> => {
  if (tags.size === 0) {
    if (cache.clear) {
      await cache.clear();
    }
    return;
  }

  if (cache.purgeByTag) {
    await Promise.all(Array.from(tags).map((tag) => cache.purgeByTag!(tag)));
    return;
  }

  if (cache.clear) {
    await cache.clear();
  }
};
