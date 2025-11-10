declare module "@redis/client" {
  export interface RedisClientOptions {
    readonly url?: string;
    readonly socket?: { readonly host?: string; readonly port?: number };
    readonly username?: string;
    readonly password?: string;
  }

  export interface RedisClientType {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, options?: { PX?: number }): Promise<unknown>;
    del(...keys: ReadonlyArray<string>): Promise<number>;
    sAdd(key: string, members: ReadonlyArray<string> | string): Promise<number>;
    sRem(key: string, member: string): Promise<number>;
    sCard(key: string): Promise<number>;
    sMembers(key: string): Promise<string[]>;
    expire(key: string, seconds: number): Promise<number | boolean>;
    ping(): Promise<string>;
    connect?(): Promise<void>;
    readonly isOpen?: boolean;
    readonly isReady?: boolean;
  }

  export function createClient(options?: RedisClientOptions): RedisClientType;
}
