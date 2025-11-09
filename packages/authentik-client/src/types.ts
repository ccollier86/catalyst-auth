import type {
  EffectiveIdentity,
  IdpUserProfile,
  SessionDescriptor,
} from "@catalyst-auth/contracts";

export interface FetchRequestInit {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string | Uint8Array;
}

export interface HeadersLike {
  get(name: string): string | null;
}

export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: HeadersLike;
  text(): Promise<string>;
}

export interface FetchLike {
  (input: string, init?: FetchRequestInit): Promise<FetchResponseLike>;
}

export interface Clock {
  now(): Date;
}

export type AdminTokenProvider = () => Promise<string>;

export interface IdentityMapperInput {
  readonly profile: IdpUserProfile;
  readonly sessions: ReadonlyArray<SessionDescriptor>;
  readonly groups: ReadonlyArray<string>;
  readonly orgId?: string;
}

export type IdentityMapper = (input: IdentityMapperInput) => EffectiveIdentity;

export interface AuthentikRoutes {
  readonly tokenPath: string;
  readonly introspectionPath: string;
  readonly userPath: (userId: string) => string;
  readonly sessionsPath: (userId: string) => string;
  readonly groupsPath: (userId: string) => string;
}

export interface AuthentikClientOptions {
  readonly baseUrl: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly adminTokenProvider: AdminTokenProvider;
  readonly fetch?: FetchLike;
  readonly clock?: Clock;
  readonly defaultScopes?: ReadonlyArray<string>;
  readonly routes?: Partial<AuthentikRoutes>;
  readonly identityMapper?: IdentityMapper;
}
