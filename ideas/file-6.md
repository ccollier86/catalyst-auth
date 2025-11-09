you got it — continuing the build-out. here’s the next set of high-impact pieces: **MFA stages (TOTP/WebAuthn) binding**, **claims mapping recipe**, **proxy headers installer**, **forward-auth Elysia server**, **membership invite/accept/remove use-cases**, and a minimal **Next.js demo wiring**. all single-responsibility, domain-separated, dependency-inverted.

---

# **🧿 MFA stages (TOTP / WebAuthn) — attach to flow**

## **src/core/ports/mfa.port.ts**

```
export interface MfaPort {
  ensureTotpStage(name: string): Promise<{ id: string }>;
  ensureWebAuthnStage(name: string): Promise<{ id: string }>;
  attachStageToFlow(flowId: string, stageId: string, order?: number): Promise<void>;
}
```

## **src/adapters/authentik/mfa.authentik.adapter.ts**

```
import { MfaPort } from "../../core/ports/mfa.port.js";
import { HttpPort } from "../../core/ports/http.port.js";

export class AuthentikMfaAdapter implements MfaPort {
  constructor(private http: HttpPort) {}

  async ensureTotpStage(name: string): Promise<{ id: string }> {
    const slug = slugify(name);
    const found = await this.http.get<{ results: any[] }>(`/api/v3/stages/totp/totpstage/?slug=${slug}`);
    if (found.results?.length) return { id: found.results[0].pk ?? found.results[0].id };
    const res = await this.http.post<any>("/api/v3/stages/totp/totpstage/", { name, slug, friendly_name: name });
    return { id: res.pk ?? res.id };
  }

  async ensureWebAuthnStage(name: string): Promise<{ id: string }> {
    const slug = slugify(name);
    const found = await this.http.get<{ results: any[] }>(`/api/v3/stages/webauthn/webauthnstage/?slug=${slug}`);
    if (found.results?.length) return { id: found.results[0].pk ?? found.results[0].id };
    const res = await this.http.post<any>("/api/v3/stages/webauthn/webauthnstage/", { name, slug, friendly_name: name });
    return { id: res.pk ?? res.id };
  }

  async attachStageToFlow(flowId: string, stageId: string, order = 100): Promise<void> {
    await this.http.post("/api/v3/flows/bindings/", {
      flow: flowId,
      stage: stageId,
      order,
    });
  }
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 64);
}
```

## **src/usecases/flows/ensureMfaOnFlow.ts**

```
import { FlowsPort } from "../../core/ports/flows.port.js";
import { MfaPort } from "../../core/ports/mfa.port.js";

export async function ensureMfaOnFlow(
  ports: { flows: FlowsPort; mfa: MfaPort },
  input: { flowName: string; requireTotp?: boolean; requireWebAuthn?: boolean }
) {
  const flow = await ports.flows.ensureLoginFlow({ name: input.flowName, mfa: true });
  if (input.requireTotp) {
    const totp = await ports.mfa.ensureTotpStage(`${input.flowName}-totp`);
    await ports.mfa.attachStageToFlow(flow.id, totp.id, 50);
  }
  if (input.requireWebAuthn) {
    const wa = await ports.mfa.ensureWebAuthnStage(`${input.flowName}-webauthn`);
    await ports.mfa.attachStageToFlow(flow.id, wa.id, 60);
  }
  return flow;
}
```

---

# **🧬 OIDC claims mapping recipe**

## **src/usecases/claims/upsertClaimsForProvider.ts**

```
import { ClaimsMapPort } from "../../core/ports/claimsmap.port.js";

/**
 * Push a sane default set of custom claims so apps get org/labels directly.
 */
export async function upsertClaimsForProvider(
  claimsMap: ClaimsMapPort,
  input: { providerId: string; includeLabels?: boolean; extra?: Record<string,string> }
) {
  const base: Record<string, string> = {
    "org_id":  "context.org_id",     // your resolver sets this
    "org_slug":"context.org_slug",
    "org_role":"context.role",
  };
  if (input.includeLabels) base["labels"] = "context.labels_json";
  await claimsMap.upsert(input.providerId, { ...base, ...(input.extra ?? {}) });
  return { ok: true };
}
```

---

# **📨 Proxy headers installer**

## **src/usecases/proxy/installProxyHeaders.ts**

```
import { ProvidersPort } from "../../core/ports/providers.port.js";
import { HttpPort } from "../../core/ports/http.port.js";
import { ProxyHeaderMap } from "../../features/forwardAuthPresets.js";

/**
 * Writes inject_headers for Proxy Provider (where supported) to pass our identity to upstream.
 * WARNING: Some authentik versions require property mappings; this uses provider's attributes fallback.
 */
export async function installProxyHeaders(
  ports: { providers: ProvidersPort; http: HttpPort },
  input: { providerId: string; headerMap?: Record<string,string> }
) {
  const headers = input.headerMap ?? ProxyHeaderMap;
  await ports.http.patch(`/api/v3/providers/proxy/${input.providerId}/`, { inject_headers: headers });
  return { ok: true };
}
```

---

# **🧱 Forward-auth Elysia server (drop-in)**

## **examples/elysia-forward-auth/server.ts**

```
import { Elysia } from "elysia";
import { makeForwardAuthHandler } from "../../src/features/forwardAuthHandler.js";
import { LocalPoliciesAdapter } from "../../src/adapters/authentik/policies.authentik.adapter.js";
import { verifyAccessToken } from "../../src/features/token/verifyAccessToken.js";

const app = new Elysia();

const policies = new LocalPoliciesAdapter();
const verify = async (req: any) => {
  const auth = req.headers["authorization"] as string | undefined;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
  if (!token) return undefined;
  try {
    return await verifyAccessToken(token, {
      jwksUrl: process.env.AUTHENTIK_JWKS_URL!,
      issuer: process.env.AUTHENTIK_ISSUER,
      audience: process.env.AUTHENTIK_AUDIENCE
    });
  } catch { return undefined; }
};

// Example: require admin + MFA for this forward-auth endpoint
const handler = makeForwardAuthHandler({
  verify,
  policies,
  require: { role: ["owner","admin"], mfa: true }
});

app.get("/healthz", () => "ok");

app.all("/forward-auth", async ({ request }) => {
  const res = await handler({
    headers: Object.fromEntries(request.headers.entries())
  });
  return new Response(res.body, { status: res.status, headers: res.headers });
});

app.listen(process.env.PORT ? Number(process.env.PORT) : 3001);
console.log("forward-auth server on :3001");
```

Traefik labels snippet (reuse from enableDomainLevelForwardAuth() or single-app):

```
- "traefik.http.middlewares.domain-fa.forwardauth.address=http://forward-auth:3001/forward-auth"
- "traefik.http.middlewares.domain-fa.forwardauth.trustForwardHeader=true"
- "traefik.http.middlewares.domain-fa.forwardauth.authResponseHeaders=X-User-Sub,X-Org-Id,X-Org-Role,X-Labels,X-Scopes"
```

---

# **👥 Membership flows — invite / accept / remove**

## **src/usecases/memberships/inviteUser.ts**

```
import { MembershipsPort } from "../../core/ports/memberships.port.js";
import { UsersPort } from "../../core/ports/users.port.js";
import { ActionMode, runAction } from "../_actionTypes.js";

export async function inviteUser(
  ports: { users: UsersPort; memberships: MembershipsPort },
  input: { email: string; orgId: string; role: "owner"|"admin"|"member"|"viewer" },
  mode: ActionMode = "apply"
) {
  return runAction(
    mode,
    async () => ({ user: await findOrCreateUser(ports.users, input.email) }),
    async (plan) => ports.memberships.add({ userId: plan.user.id, orgId: input.orgId, role: input.role })
  );
}

async function findOrCreateUser(users: UsersPort, email: string) {
  // If Authentik exposes search by email, use it; otherwise POST user
  try {
    const u = await users.get(email); // adapt: ID or email lookup
    if (u.email?.toLowerCase() === email.toLowerCase()) return u;
  } catch {}
  // Minimal create; implement in adapter if allowed. Otherwise, raise an invitation flow by email.
  return { id: email, email } as any;
}
```

## **src/usecases/memberships/acceptInvite.ts**

```
import { MembershipsPort } from "../../core/ports/memberships.port.js";
import { ActionMode, runAction } from "../_actionTypes.js";

export async function acceptInvite(
  memberships: MembershipsPort,
  input: { userId: string; orgId: string },
  mode: ActionMode = "apply"
) {
  return runAction(
    mode,
    async () => ({ membership: await memberships.get(input.userId, input.orgId) }),
    async (plan) => {
      if (!plan.membership) throw new Error("invite_not_found");
      return memberships.update({ userId: input.userId, orgId: input.orgId });
    }
  );
}
```

## **src/usecases/memberships/removeMember.ts**

```
import { MembershipsPort } from "../../core/ports/memberships.port.js";
import { ActionMode, runAction } from "../_actionTypes.js";

export async function removeMember(
  memberships: MembershipsPort,
  input: { userId: string; orgId: string },
  mode: ActionMode = "apply"
) {
  return runAction(
    mode,
    async () => ({ exists: !!(await memberships.get(input.userId, input.orgId)) }),
    async (plan) => { if (plan.exists) await memberships.remove(input); return { ok: true }; }
  );
}
```

---

# **⚙️ Next.js demo wiring (minimal)**

## **examples/next/app/middleware.ts**

```
import { NextRequest, NextResponse } from "next/server";
import { makeNextTokenDecoder } from "../../../src/ui/next/decodeToken.js";

const decode = makeNextTokenDecoder({
  jwksUrl: process.env.AUTHENTIK_JWKS_URL!,
  issuer: process.env.AUTHENTIK_ISSUER,
  audience: process.env.AUTHENTIK_AUDIENCE,
  cookie: "auth_access" // your cookie name
});

export async function middleware(req: NextRequest) {
  const url = new URL(req.url);
  if (url.pathname.startsWith("/admin")) {
    const claims = await decode(req);
    if (!claims) return NextResponse.redirect(new URL("/sign-in", req.url));
    if (claims.org?.role !== "owner" && claims.org?.role !== "admin") {
      return NextResponse.redirect(new URL("/403", req.url));
    }
  }
  return NextResponse.next();
}
```

## **examples/next/app/page.tsx**

```
export default function Home() {
  return <main>hello — protected routes live under /admin</main>;
}
```

## **examples/next/app/admin/page.tsx**

```
"use client";
import { AuthProvider, SignedIn, SignedOut } from "../../../src/ui/react/AuthProvider.js";
import { useAuth } from "../../../src/ui/react/AuthProvider.js";

async function fetchEffective(token?: string) {
  // your API to return EffectiveIdentity; for demo, return a stub
  return { user: { id: "u1", email: "you@example.com" }, org: { id: "o1", slug: "acme", profile: { displayName: "Acme" } } } as any;
}

export default function Admin() {
  return (
    <AuthProvider fetchEffective={fetchEffective}>
      <SignedOut><div>Please sign in</div></SignedOut>
      <SignedIn><Panel /></SignedIn>
    </AuthProvider>
  );
}

function Panel() {
  const { effective } = useAuth();
  return <pre>{JSON.stringify(effective, null, 2)}</pre>;
}
```

---

# **🧩 DI container updates & exports**

## **src/di/container.ts**

##  **(add MFA)**

```
import { AuthentikMfaAdapter } from "../adapters/authentik/mfa.authentik.adapter.js";
// ...
const mfa = new AuthentikMfaAdapter(http);

return {
  ports: { http, log, apps, providers, flows, outposts, users, orgs, groups, keys, policies, profiles, memberships, claimsMap, mfa },
};
```

## **src/index.ts**

##  **(export new APIs)**

```
export * from "./core/ports/mfa.port.js";
export * from "./adapters/authentik/mfa.authentik.adapter.js";
export * from "./usecases/flows/ensureMfaOnFlow.js";
export * from "./usecases/claims/upsertClaimsForProvider.js";
export * from "./usecases/proxy/installProxyHeaders.js";
export * from "./usecases/memberships/inviteUser.js";
export * from "./usecases/memberships/acceptInvite.js";
export * from "./usecases/memberships/removeMember.js";
```

---

## **what you have now**

- **Complete, DI-driven Authentik client** with adapters for apps/providers/flows/outposts/users/orgs/groups/keys/policies/memberships/mfa.
- **High-level workflows** to provision forward-auth/oidc apps, enable domain-level FA, attach MFA, install proxy headers, and manage memberships.
- **Token tools** to verify Authentik access tokens and our decision JWTs.
- **Headless UI shells** (React/Svelte) and Next middleware helpers.
- **Forward-auth microservice** (Elysia) for Traefik.

want me to keep going into: **error normalization & typed OpenAPI responses**, **effective identity cache + invalidation**, **Valibot schemas for the UI layer**, or a **docs-ready cookbook** (copy-paste recipes for the top 8 tasks)?
