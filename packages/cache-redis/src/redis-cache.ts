import type { CachePort, CacheSetOptions } from "@catalyst-auth/contracts";
import type { RedisClientOptions, RedisClientType } from "@redis/client";

export interface RedisCacheOptions<TClient extends RedisClientType = RedisClientType> {
  readonly client: TClient;
  readonly keyPrefix?: string;
  readonly defaultTtlSeconds?: number;
}

export interface RedisCacheHealthIndicator {
  readonly name: string;
  readonly check: () => Promise<boolean>;
}

export class RedisCache<TValue = unknown> implements CachePort<TValue> {
  private readonly client: RedisClientType;
  private readonly keyPrefix: string;
  private readonly defaultTtlSeconds?: number;
  private readonly keysIndexKey: string;

  constructor(options: RedisCacheOptions) {
    this.client = options.client;
    this.keyPrefix = normalizePrefix(options.keyPrefix);
    this.defaultTtlSeconds = options.defaultTtlSeconds;
    this.keysIndexKey = this.buildIndexKey("keys");
  }

  async get(key: string): Promise<TValue | undefined> {
    const stored = await this.client.get(this.withPrefix(key));
    if (!stored) {
      return undefined;
    }
    return deserialize<TValue>(stored);
  }

  async set(key: string, value: TValue, options?: CacheSetOptions): Promise<void> {
    await this.delete(key);

    const redisKey = this.withPrefix(key);
    const payload = serialize(value);
    const ttlSeconds = options?.ttlSeconds ?? this.defaultTtlSeconds;

    if (ttlSeconds !== undefined) {
      await this.client.set(redisKey, payload, { PX: ttlSeconds * 1000 });
    } else {
      await this.client.set(redisKey, payload);
    }

    await this.client.sAdd(this.keysIndexKey, key);

    const tags = options?.tags?.filter(Boolean) ?? [];
    if (tags.length === 0) {
      await this.client.del(this.tagsKey(key));
      return;
    }

    const tagsKey = this.tagsKey(key);
    await this.client.del(tagsKey);
    await this.client.sAdd(tagsKey, tags);
    if (ttlSeconds !== undefined) {
      await this.client.expire(tagsKey, ttlSeconds);
    }

    await Promise.all(
      tags.map(async (tag) => {
        const indexKey = this.tagIndexKey(tag);
        await this.client.sAdd(indexKey, key);
      }),
    );
  }

  async delete(key: string): Promise<void> {
    const tagsKey = this.tagsKey(key);
    const tags = await this.client.sMembers(tagsKey);
    if (tags.length > 0) {
      await Promise.all(
        tags.map(async (tag) => {
          const indexKey = this.tagIndexKey(tag);
          await this.client.sRem(indexKey, key);
          const remaining = await this.client.sCard(indexKey);
          if (remaining === 0) {
            await this.client.del(indexKey);
          }
        }),
      );
    }

    await this.client.del(this.withPrefix(key), tagsKey);
    await this.client.sRem(this.keysIndexKey, key);
  }

  async purgeByTag(tag: string): Promise<void> {
    const indexKey = this.tagIndexKey(tag);
    const keys = await this.client.sMembers(indexKey);
    if (keys.length === 0) {
      return;
    }

    await Promise.all(keys.map((key) => this.delete(key)));
    await this.client.del(indexKey);
  }

  async clear(): Promise<void> {
    const keys = await this.client.sMembers(this.keysIndexKey);
    if (keys.length === 0) {
      return;
    }
    await Promise.all(keys.map((key) => this.delete(key)));
    await this.client.del(this.keysIndexKey);
  }

  async ping(): Promise<void> {
    await this.client.ping();
  }

  async checkHealth(): Promise<boolean> {
    try {
      await this.ping();
      return true;
    } catch {
      return false;
    }
  }

  private withPrefix(key: string): string {
    const trimmed = key.replace(/^:+/, "");
    return this.keyPrefix ? `${this.keyPrefix}:${trimmed}` : trimmed;
  }

  private tagsKey(key: string): string {
    return this.withPrefix(`__tags__:${key}`);
  }

  private tagIndexKey(tag: string): string {
    return this.withPrefix(`__tag__:${tag}`);
  }

  private buildIndexKey(name: string): string {
    return this.withPrefix(`__index__:${name}`);
  }
}

const serialize = <T>(value: T): string => JSON.stringify(value);

const deserialize = <T>(payload: string): T => JSON.parse(payload) as T;

const normalizePrefix = (prefix?: string): string => {
  if (!prefix) {
    return "";
  }
  return prefix.replace(/:+$/, "");
};

export interface CreateRedisCacheOptions<TClient extends RedisClientType = RedisClientType>
  extends Partial<RedisCacheOptions<TClient>> {
  readonly client?: TClient;
  readonly onError?: (error: unknown) => void;
}

export interface ConnectRedisCacheOptions extends Omit<CreateRedisCacheOptions, "client"> {
  readonly url?: string;
  readonly socket?: RedisClientOptions["socket"];
  readonly username?: string;
  readonly password?: string;
}

export const createRedisCache = <TValue = unknown>(
  options: CreateRedisCacheOptions,
): RedisCache<TValue> => {
  if (!options.client) {
    throw new Error(
      "createRedisCache requires a Redis client instance. Provide an existing client or call connectRedisCache to create one.",
    );
  }

  ensureClientConnected(options.client, options.onError);

  return new RedisCache<TValue>({
    client: options.client,
    keyPrefix: options.keyPrefix,
    defaultTtlSeconds: options.defaultTtlSeconds,
  });
};

export const connectRedisCache = async <TValue = unknown>(
  options: ConnectRedisCacheOptions = {},
): Promise<RedisCache<TValue>> => {
  const createClient = await resolveCreateClient();
  const client = createClient({
    url: options.url,
    socket: options.socket,
    username: options.username,
    password: options.password,
  });

  if (!client.isOpen && !client.isReady && typeof client.connect === "function") {
    await client.connect();
  }

  return new RedisCache<TValue>({
    client,
    keyPrefix: options.keyPrefix,
    defaultTtlSeconds: options.defaultTtlSeconds,
  });
};

export const createRedisCacheHealthIndicator = (
  name: string,
  cache: RedisCache,
): RedisCacheHealthIndicator => ({
  name,
  check: () => cache.checkHealth(),
});

const ensureClientConnected = (
  client: RedisClientType,
  onError?: (error: unknown) => void,
): void => {
  if (typeof client.connect !== "function") {
    return;
  }

  if (client.isOpen || client.isReady) {
    return;
  }

  void client.connect().catch((error: unknown) => {
    onError?.(error);
  });
};

const resolveCreateClient = async (): Promise<
  (options?: RedisClientOptions) => RedisClientType
> => {
  try {
    const module = await import("@redis/client");
    return module.createClient;
  } catch (error) {
    throw new Error(
      "@redis/client is required to create a Redis cache client. Install @redis/client or pass an existing client to createRedisCache.",
      { cause: error },
    );
  }
};
