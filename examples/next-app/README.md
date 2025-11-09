# Next.js integration example

This example demonstrates how to wire the `@catalyst-auth/sdk` inside a Next.js route handler. The code relies on the in-memory adapters that ship with the monorepo, but any implementation that satisfies the SDK ports will work.

## Highlights

- Authenticates users by exchanging an authorization code and verifying the session state.
- Hydrates organization and membership context for the active user.
- Issues decision JWTs to protect downstream APIs.

## Example route handler

```ts
import { NextResponse } from "next/server";
import { createCatalystSdk } from "@catalyst-auth/sdk";
import { createInMemoryProfileStore } from "@catalyst-auth/profile-memory";
import { createMemoryKeyStore } from "@catalyst-auth/key-memory";
import { createMemoryWebhookDelivery } from "@catalyst-auth/webhook-memory";
import { createMemoryTokenService } from "../lib/token-service";
import { authentikAdapter } from "../lib/authentik-adapter";

const sdk = createCatalystSdk({
  idp: authentikAdapter,
  profileStore: createInMemoryProfileStore(),
  keyStore: createMemoryKeyStore(),
  webhookDelivery: createMemoryWebhookDelivery(),
  tokenService: createMemoryTokenService(),
});

export async function POST(request: Request) {
  const body = await request.json();

  const signIn = await sdk.auth.signInWithCode({
    code: body.code,
    codeVerifier: body.codeVerifier,
    redirectUri: body.redirectUri,
    clientId: process.env.NEXT_PUBLIC_AUTH_CLIENT_ID!,
  });

  if (!signIn.ok) {
    return NextResponse.json({ error: signIn.error }, { status: 401 });
  }

  const session = await sdk.auth.verifySession({
    userId: body.userId,
    sessionId: body.sessionId,
  });

  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: 401 });
  }

  const identity = await sdk.me.getEffectiveIdentity({ userId: body.userId, orgId: body.orgId });
  if (!identity.ok) {
    return NextResponse.json({ error: identity.error }, { status: 403 });
  }

  const decision = await sdk.auth.issueDecisionToken({
    identity: identity.value,
    action: "dashboard.view",
  });

  return NextResponse.json({
    tokens: signIn.value,
    session: session.value.session,
    decision: decision.ok ? decision.value : undefined,
  });
}
```
