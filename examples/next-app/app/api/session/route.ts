import { NextResponse } from "next/server";
import { createCatalystSdk } from "@catalyst-auth/sdk";
import { createInMemoryProfileStore } from "@catalyst-auth/profile-memory";
import { createMemoryKeyStore } from "@catalyst-auth/key-memory";
import { createMemoryWebhookDelivery } from "@catalyst-auth/webhook-memory";

import { authentikAdapter } from "../../lib/authentik-adapter";
import { tokenService } from "../../lib/token-service";

const sdk = createCatalystSdk({
  idp: authentikAdapter,
  profileStore: createInMemoryProfileStore(),
  keyStore: createMemoryKeyStore(),
  webhookDelivery: createMemoryWebhookDelivery(),
  tokenService,
});

type SignInPayload = {
  readonly code: string;
  readonly codeVerifier?: string;
  readonly redirectUri: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly orgId?: string;
};

export async function POST(request: Request) {
  const payload = (await request.json()) as SignInPayload;

  const tokens = await sdk.auth.signInWithCode({
    code: payload.code,
    codeVerifier: payload.codeVerifier,
    redirectUri: payload.redirectUri,
    clientId: process.env.NEXT_PUBLIC_AUTH_CLIENT_ID!,
  });

  if (!tokens.ok) {
    return NextResponse.json({ error: tokens.error }, { status: 401 });
  }

  const session = await sdk.auth.verifySession({
    userId: payload.userId,
    sessionId: payload.sessionId,
  });

  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: 401 });
  }

  const identity = await sdk.me.getEffectiveIdentity({
    userId: payload.userId,
    orgId: payload.orgId,
  });

  const decision = identity.ok
    ? await sdk.auth.issueDecisionToken({
        identity: identity.value,
        action: "dashboard.view",
      })
    : identity;

  return NextResponse.json({
    tokens: tokens.value,
    session: session.value.session,
    identity: identity.ok ? identity.value : undefined,
    decision: decision.ok ? decision.value : undefined,
  });
}
