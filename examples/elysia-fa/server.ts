import { Elysia } from "elysia";
import { createCatalystSdk } from "@catalyst-auth/sdk";
import { createInMemoryProfileStore } from "@catalyst-auth/profile-memory";
import { createMemoryKeyStore } from "@catalyst-auth/key-memory";
import { createMemoryWebhookDelivery } from "@catalyst-auth/webhook-memory";

import { authentikAdapter } from "../next-app/lib/authentik-adapter";
import { tokenService } from "../next-app/lib/token-service";

const sdk = createCatalystSdk({
  idp: authentikAdapter,
  profileStore: createInMemoryProfileStore(),
  keyStore: createMemoryKeyStore(),
  webhookDelivery: createMemoryWebhookDelivery(),
  tokenService,
});

type SessionPayload = {
  readonly code: string;
  readonly codeVerifier?: string;
  readonly redirectUri: string;
  readonly clientId: string;
  readonly userId: string;
  readonly orgId?: string;
};

new Elysia()
  .post("/session", async ({ body }: { body: SessionPayload }) => {
    const result = await sdk.auth.signInWithCode({
      code: body.code,
      codeVerifier: body.codeVerifier,
      redirectUri: body.redirectUri,
      clientId: body.clientId,
    });

    if (!result.ok) {
      return { status: 401, body: result.error };
    }

    const identity = await sdk.me.getEffectiveIdentity({ userId: body.userId, orgId: body.orgId });
    const decision = identity.ok
      ? await sdk.auth.issueDecisionToken({ identity: identity.value, action: "api.consume" })
      : identity;

    return {
      status: 200,
      body: {
        tokens: result.value,
        identity: identity.ok ? identity.value : undefined,
        decision: decision.ok ? decision.value : undefined,
      },
    };
  })
  .listen(3000);
