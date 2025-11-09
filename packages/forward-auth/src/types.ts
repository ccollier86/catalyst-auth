import type {
  AuditLogPort,
  CachePort,
  KeyStorePort,
  ResourceDescriptor,
  EffectiveIdentity,
  SessionStorePort,
} from "@catalyst-auth/contracts";

export interface DecisionCacheEntry {
  readonly headers: Record<string, string>;
  readonly expiresAt: string;
}

export interface ForwardAuthRequest {
  readonly headers: Record<string, string | undefined>;
  readonly method: string;
  readonly path: string;
  readonly resource?: ResourceDescriptor;
  readonly action?: string;
  readonly orgId?: string;
  readonly environment?: Record<string, unknown>;
}

export interface ForwardAuthResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body?: string;
}

export interface ForwardAuthLogger {
  readonly debug?: (...args: ReadonlyArray<unknown>) => void;
  readonly info?: (...args: ReadonlyArray<unknown>) => void;
  readonly warn?: (...args: ReadonlyArray<unknown>) => void;
  readonly error?: (...args: ReadonlyArray<unknown>) => void;
}

export interface ForwardAuthConfig {
  readonly decisionCache?: CachePort<DecisionCacheEntry>;
  readonly decisionCacheKeyPrefix?: string;
  readonly decisionCacheTtlSeconds?: number;
  readonly keyStore?: KeyStorePort;
  readonly auditLog?: AuditLogPort;
  readonly sessionStore?: SessionStorePort;
  readonly hashApiKey?: (secret: string) => Promise<string> | string;
  readonly logger?: ForwardAuthLogger;
  readonly now?: () => Date;
  readonly buildAction?: (request: ForwardAuthRequest) => string;
  readonly buildResource?: (request: ForwardAuthRequest) => ResourceDescriptor | undefined;
  readonly buildEnvironment?: (
    request: ForwardAuthRequest,
    identity: EffectiveIdentity,
  ) => Record<string, unknown> | undefined;
}

export interface ForwardAuthHandlerContext {
  readonly request: Request;
  readonly url: URL;
  readonly headers: Record<string, string>;
}

export interface ForwardAuthFetchHandlerOptions {
  readonly forwardedMethodHeader?: string;
  readonly forwardedUriHeader?: string;
  readonly forwardedHostHeader?: string;
  readonly forwardedProtoHeader?: string;
  readonly orgHeader?: string;
  readonly environmentHeaderPrefix?: string;
  readonly buildResource?: (context: ForwardAuthHandlerContext) => ResourceDescriptor | undefined;
  readonly buildAction?: (context: ForwardAuthHandlerContext) => string | undefined;
  readonly buildEnvironment?: (
    context: ForwardAuthHandlerContext,
  ) => Record<string, unknown> | undefined;
}
