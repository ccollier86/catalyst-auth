# Elysia edge function example

The Elysia example shows how to consume the Catalyst SDK from a lightweight API handler. The file below wires the SDK into a single endpoint that exchanges tokens, loads profile data, and responds with the effective identity payload.

## Running locally

1. Install dependencies in the monorepo: `pnpm install`
2. Start the sample server: `bun run examples/elysia-fa/server.ts`

## server.ts

```ts
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

new Elysia()
  .post("/session", async ({ body }) => {
    const result = await sdk.auth.signInWithCode({
      code: body.code,
      redirectUri: body.redirectUri,
      clientId: body.clientId,
      codeVerifier: body.codeVerifier,
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
```
