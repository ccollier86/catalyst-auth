import type {
  EntitlementStorePort,
  IdpAdapterPort,
  KeyStorePort,
  ProfileStorePort,
  SessionStorePort,
  TokenServicePort,
  WebhookDeliveryPort,
} from "@catalyst-auth/contracts";

import { createAuthModule } from "./auth/index.js";
import type { AuthModule } from "./auth/index.js";
import { createOrgsModule } from "./orgs/index.js";
import type { OrgsModule } from "./orgs/index.js";
import { createProfilesModule } from "./profiles/index.js";
import type { ProfilesModule } from "./profiles/index.js";
import { createKeysModule } from "./keys/index.js";
import type { KeysModule } from "./keys/index.js";
import { createEntitlementsModule } from "./entitlements/index.js";
import type { EntitlementsModule } from "./entitlements/index.js";
import { createWebhooksModule } from "./webhooks/index.js";
import type { WebhooksModule } from "./webhooks/index.js";
import { createMeModule } from "./me/index.js";
import type { MeModule } from "./me/index.js";
import { createSessionsModule } from "./sessions/index.js";
import type { SessionsModule } from "./sessions/index.js";

/**
 * Dependencies required to bootstrap the Catalyst SDK. Each dependency maps to a port
 * that can be satisfied by different infrastructure adapters.
 */
export interface CatalystSdkDependencies {
  readonly idp: IdpAdapterPort;
  readonly profileStore: ProfileStorePort;
  readonly keyStore: KeyStorePort;
  readonly entitlementStore: EntitlementStorePort;
  readonly sessionStore: SessionStorePort;
  readonly webhookDelivery: WebhookDeliveryPort;
  readonly tokenService: TokenServicePort;
}

/**
 * Public surface for the Catalyst SDK. Modules are separated by concern but share the same
 * dependency container to support dependency injection.
 */
export interface CatalystSdk {
  readonly auth: AuthModule;
  readonly orgs: OrgsModule;
  readonly profiles: ProfilesModule;
  readonly keys: KeysModule;
  readonly entitlements: EntitlementsModule;
  readonly webhooks: WebhooksModule;
  readonly sessions: SessionsModule;
  readonly me: MeModule;
}

/**
 * Creates a Catalyst SDK instance backed by the provided dependencies.
 */
export const createCatalystSdk = (deps: CatalystSdkDependencies): CatalystSdk => ({
  auth: createAuthModule(deps),
  orgs: createOrgsModule(deps),
  profiles: createProfilesModule(deps),
  keys: createKeysModule(deps),
  entitlements: createEntitlementsModule(deps),
  webhooks: createWebhooksModule(deps),
  sessions: createSessionsModule(deps),
  me: createMeModule(deps),
});

export type {
  AuthModule,
  KeysModule,
  MeModule,
  OrgsModule,
  ProfilesModule,
  EntitlementsModule,
  SessionsModule,
  WebhooksModule,
  EntitlementStorePort,
  IdpAdapterPort,
  KeyStorePort,
  ProfileStorePort,
  SessionStorePort,
  TokenServicePort,
  WebhookDeliveryPort,
};
