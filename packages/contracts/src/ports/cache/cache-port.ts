export interface CacheSetOptions {
  readonly ttlSeconds?: number;
  readonly tags?: ReadonlyArray<string>;
}

export interface CachePort<TValue = unknown> {
  get(key: string): Promise<TValue | undefined>;
  set(key: string, value: TValue, options?: CacheSetOptions): Promise<void>;
  delete(key: string): Promise<void>;
  purgeByTag?(tag: string): Promise<void>;
  clear?(): Promise<void>;
}
