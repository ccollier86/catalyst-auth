import type { CachePort, CacheSetOptions } from "@catalyst-auth/contracts";

export interface MemoryCacheOptions {
  readonly clock?: () => number;
}

type TimerHandle = ReturnType<typeof setTimeout>;

interface CacheEntry<T> {
  readonly value: T;
  readonly expiresAt?: number;
  readonly tags?: Set<string>;
  timeoutId?: TimerHandle;
}

export class MemoryCache<TValue = unknown> implements CachePort<TValue> {
  private readonly entries = new Map<string, CacheEntry<TValue>>();
  private readonly tagIndex = new Map<string, Set<string>>();
  private readonly clock: () => number;

  constructor(options: MemoryCacheOptions = {}) {
    this.clock = options.clock ?? Date.now;
  }

  async get(key: string): Promise<TValue | undefined> {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }

    if (this.isExpired(entry)) {
      this.evict(key, entry);
      return undefined;
    }

    return entry.value;
  }

  async set(key: string, value: TValue, options?: CacheSetOptions): Promise<void> {
    this.removeExistingEntry(key);

    const tags = options?.tags ? new Set(options.tags) : undefined;
    const expiresAt = this.computeExpiry(options?.ttlSeconds);
    const entry: CacheEntry<TValue> = {
      value,
      expiresAt,
      tags,
    };

    if (expiresAt !== undefined) {
      const delay = Math.max(0, expiresAt - this.clock());
      entry.timeoutId = setTimeout(() => {
        this.handleExpiration(key, entry);
      }, delay);
    }

    this.entries.set(key, entry);
    if (tags) {
      for (const tag of tags) {
        const keys = this.tagIndex.get(tag) ?? new Set<string>();
        keys.add(key);
        this.tagIndex.set(tag, keys);
      }
    }
  }

  async delete(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }

    this.evict(key, entry);
  }

  async purgeByTag(tag: string): Promise<void> {
    const keys = this.tagIndex.get(tag);
    if (!keys) {
      return;
    }

    for (const key of Array.from(keys)) {
      await this.delete(key);
    }

    this.tagIndex.delete(tag);
  }

  async clear(): Promise<void> {
    for (const [key, entry] of Array.from(this.entries.entries())) {
      this.evict(key, entry);
    }

    this.tagIndex.clear();
  }

  private computeExpiry(ttlSeconds?: number): number | undefined {
    if (ttlSeconds === undefined) {
      return undefined;
    }

    return this.clock() + ttlSeconds * 1000;
  }

  private isExpired(entry: CacheEntry<TValue>): boolean {
    return entry.expiresAt !== undefined && entry.expiresAt <= this.clock();
  }

  private handleExpiration(key: string, entry: CacheEntry<TValue>): void {
    const current = this.entries.get(key);
    if (current !== entry) {
      return;
    }

    if (this.isExpired(entry)) {
      this.evict(key, entry);
    }
  }

  private removeExistingEntry(key: string): void {
    const existing = this.entries.get(key);
    if (!existing) {
      return;
    }

    this.evict(key, existing);
  }

  private evict(key: string, entry: CacheEntry<TValue>): void {
    this.entries.delete(key);
    if (entry.timeoutId !== undefined) {
      clearTimeout(entry.timeoutId);
    }

    if (entry.tags) {
      for (const tag of entry.tags) {
        const keys = this.tagIndex.get(tag);
        if (!keys) {
          continue;
        }

        keys.delete(key);
        if (keys.size === 0) {
          this.tagIndex.delete(tag);
        }
      }
    }
  }
}

export const createMemoryCache = <TValue = unknown>(options?: MemoryCacheOptions): MemoryCache<TValue> => {
  return new MemoryCache<TValue>(options);
};
