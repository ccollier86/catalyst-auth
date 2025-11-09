heck yes — with this architecture (ports + SRP + DI) you can bolt on features, swap vendors, and evolve flows with **minimal blast radius**. let’s keep building out the client so it’s truly “plug-anything, break-nothing.”

below I’m adding: memberships, claims/header mapping, a forward-auth handler, dry-run/plan/apply scaffolding, plus **headless UI shells** for React (Radix-friendly), Svelte (Bits-UI-friendly), and Next middleware helpers. all files are single-purpose and inversion-friendly.

---

# **➕ Domain: Memberships (teams/orgs + groups)**

## **src/core/models/membership.ts**

```
export type Role = "owner" | "admin" | "member" | "viewer";

export interface Membership {
  id: string;
  userId: string;
  orgId: string;
  role: Role;
  groups?: string[]; // group ids (departments) within the org
  labelsDelta?: Record<string, string | boolean>;
  status?: "active" | "invited" | "suspended";
  createdAt?: string;
  updatedAt?: string;
}
```

## **src/core/ports/memberships.port.ts**

```
import { Membership, Role } from "../models/membership.js";

export interface MembershipsPort {
  listByOrg(orgId: string): Promise<Membership[]>;
  listByUser(userId: string): Promise<Membership[]>;
  get(userId: string, orgId: string): Promise<Membership | undefined>;
  add(input: { userId: string; orgId: string; role: Role; groups?: string[]; labelsDelta?: Record<string, string|boolean> }): Promise<Membership>;
  update(input: { userId: string; orgId: string; role?: Role; groups?: string[]; labelsDelta?: Record<string, string|boolean> }): Promise<Membership>;
  remove(input: { userId: string; orgId: string }): Promise<void>;
}
```

## **src/adapters/authentik/memberships.authentik.adapter.ts**

> We’ll model **Org as a Group**, and “membership” as (user ∈ orgGroup) + role in attributes. Sub-groups represent departments.

```
import { MembershipsPort } from "../../core/ports/memberships.port.js";
import { Membership, Role } from "../../core/models/membership.js";
import { HttpPort } from "../../core/ports/http.port.js";

export class AuthentikMembershipsAdapter implements MembershipsPort {
  constructor(private http: HttpPort) {}

  async listByOrg(orgId: string): Promise<Membership[]> {
    const res = await this.http.get<{ results: any[] }>(`/api/v3/core/groupmembership/?group=${encodeURIComponent(orgId)}`);
    return (res.results ?? []).map(this.map);
  }

  async listByUser(userId: string): Promise<Membership[]> {
    const res = await this.http.get<{ results: any[] }>(`/api/v3/core/groupmembership/?user=${encodeURIComponent(userId)}`);
    return (res.results ?? []).map(this.map);
  }

  async get(userId: string, orgId: string): Promise<Membership | undefined> {
    const res = await this.http.get<{ results: any[] }>(`/api/v3/core/groupmembership/?user=${encodeURIComponent(userId)}&group=${encodeURIComponent(orgId)}`);
    const m = res.results?.[0];
    return m ? this.map(m) : undefined;
  }

  async add(input: { userId: string; orgId: string; role: Role; groups?: string[]; labelsDelta?: Record<string, string|boolean> }): Promise<Membership> {
    const m = await this.http.post<any>("/api/v3/core/groupmembership/", {
      user: input.userId, group: input.orgId,
      attributes: { role: input.role, groups: input.groups ?? [], labelsDelta: input.labelsDelta ?? {} }
    });
    return this.map(m);
  }

  async update(input: { userId: string; orgId: string; role?: Role; groups?: string[]; labelsDelta?: Record<string, string|boolean> }): Promise<Membership> {
    const curr = await this.get(input.userId, input.orgId);
    if (!curr) throw new Error("membership_not_found");
    const m = await this.http.patch<any>(`/api/v3/core/groupmembership/${curr.id}/`, {
      attributes: {
        role: input.role ?? curr.role,
        groups: input.groups ?? curr.groups ?? [],
        labelsDelta: input.labelsDelta ?? curr.labelsDelta ?? {}
      }
    });
    return this.map(m);
  }

  async remove(input: { userId: string; orgId: string }): Promise<void> {
    const curr = await this.get(input.userId, input.orgId);
    if (!curr) return;
    await this.http.del(`/api/v3/core/groupmembership/${curr.id}/`);
  }

  private map = (raw: any): Membership => ({
    id: raw?.pk ?? raw?.id,
    userId: raw?.user,
    orgId: raw?.group,
    role: raw?.attributes?.role ?? "member",
    groups: raw?.attributes?.groups ?? [],
    labelsDelta: raw?.attributes?.labelsDelta ?? {},
    status: "active",
    createdAt: raw?.created,
    updatedAt: raw?.modified
  });
}
```

---

# **🧩 Claims/headers mapping & forward-auth handler**

## **src/features/claimsMapping.ts**

```
import { AccessTokenClaims } from "../core/models/session.js";
import { EffectiveIdentity } from "../core/models/profile.js";

export function claimsFromEffective(eff: EffectiveIdentity): AccessTokenClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: "authkit",
    aud: "app",
    sub: eff.user.id,
    iat: now,
    exp: now + 15 * 60,
    session: { id: `sess-${eff.user.id}`, mfa: true, amr: ["pwd"] },
    org: eff.org ? { id: eff.org.id, slug: eff.org.slug, role: eff.membership?.role ?? "member" } : undefined,
    groups: eff.groups?.map(g => g.id),
    labels: eff.labels ?? {},
    plan: eff.plan,
    ent: eff.entitlements ? { f: eff.entitlements.features, l: eff.entitlements.limits } : undefined,
    scopes: undefined
  };
}

/** A simple proxy/header map for forward-auth (extend as needed). */
export function headersFromClaims(claims: AccessTokenClaims): Record<string,string> {
  const out: Record<string,string> = { "X-User-Sub": claims.sub };
  if (claims.org) { out["X-Org-Id"] = claims.org.id; out["X-Org-Role"] = claims.org.role; out["X-Org-Slug"] = claims.org.slug; }
  if (claims.labels) out["X-Labels"] = Buffer.from(JSON.stringify(claims.labels)).toString("base64url");
  if (claims.scopes?.length) out["X-Scopes"] = claims.scopes.join(",");
  return out;
}
```

## **src/features/forwardAuthHandler.ts**

> A tiny, framework-agnostic handler you can adapt to Elysia/Express/Fastify. It verifies token (or session), evaluates policy, and returns headers for Traefik.

```
import { PoliciesPort } from "../core/ports/policies.port.js";
import { RoutePolicyRequire } from "../core/models/policy.js";
import { AccessTokenClaims } from "../core/models/session.js";
import { headersFromClaims } from "./claimsMapping.js";

export type TokenVerifier = (req: any) => Promise<AccessTokenClaims | undefined>;

export function makeForwardAuthHandler(deps: {
  verify: TokenVerifier;
  policies: PoliciesPort;
  require: RoutePolicyRequire;       // what this route needs
}) {
  return async function handle(req: any) {
    try {
      const claims = await deps.verify(req);
      if (!claims) return { status: 401, headers: {}, body: "unauthorized" };
      const decision = await deps.policies.evaluate(deps.require, claims);
      if (!decision.allow) return { status: 403, headers: {}, body: "forbidden" };
      return { status: 200, headers: headersFromClaims(claims), body: "" };
    } catch (e) {
      return { status: 500, headers: {}, body: "error" };
    }
  };
}
```

---

# **🧪 Dry-run / plan / apply scaffolding**

## **src/usecases/\_actionTypes.ts**

```
export type ActionMode = "dryRun" | "plan" | "apply";
export interface ActionResult<TPlan = unknown, TApply = unknown> {
  mode: ActionMode;
  ok: boolean;
  plan?: TPlan;
  value?: TApply;
  notes?: string[];
}

export async function runAction<TPlan, TApply>(
  mode: ActionMode,
  buildPlan: () => Promise<TPlan>,
  doApply: (plan: TPlan) => Promise<TApply>
): Promise<ActionResult<TPlan, TApply>> {
  const plan = await buildPlan();
  if (mode === "dryRun") return { mode, ok: true, plan, notes: ["no changes executed"] };
  if (mode === "plan")  return { mode, ok: true, plan };
  const value = await doApply(plan);
  return { mode, ok: true, plan, value };
}
```

## **src/usecases/memberships/addUserToOrg.ts**

```
import { MembershipsPort } from "../../core/ports/memberships.port.js";
import { ActionMode, runAction } from "../_actionTypes.js";

export async function addUserToOrg(
  memberships: MembershipsPort,
  input: { userId: string; orgId: string; role: "owner"|"admin"|"member"|"viewer"; groups?: string[] },
  mode: ActionMode = "apply"
) {
  return runAction(
    mode,
    async () => ({ exists: !!(await memberships.get(input.userId, input.orgId)), input }),
    async (plan) => {
      if (plan.exists) return await memberships.update({ userId: input.userId, orgId: input.orgId, role: input.role, groups: input.groups });
      return await memberships.add({ userId: input.userId, orgId: input.orgId, role: input.role, groups: input.groups });
    }
  );
}
```

---

# **🧱 UI — React (headless, Radix-friendly)**

## **src/ui/react/AuthProvider.tsx**

```
import React, { createContext, useContext, useMemo, useState, useEffect } from "react";
import type { EffectiveIdentity } from "../../core/models/profile.js";

type AuthCtx = {
  loading: boolean;
  token?: string;
  effective?: EffectiveIdentity;
  setToken(t?: string): void;
  refresh(orgId?: string): Promise<void>;
};

const Ctx = createContext<AuthCtx>({ loading: true, setToken(){}, async refresh(){} });

export function AuthProvider({ children, fetchEffective, initialToken }: {
  children: React.ReactNode;
  fetchEffective: (token?: string, orgId?: string) => Promise<EffectiveIdentity>;
  initialToken?: string;
}) {
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | undefined>(initialToken);
  const [effective, setEffective] = useState<EffectiveIdentity | undefined>(undefined);

  const refresh = async (orgId?: string) => {
    setLoading(true);
    setEffective(await fetchEffective(token, orgId));
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, [token]);

  const value = useMemo(() => ({ loading, token, effective, setToken, refresh }), [loading, token, effective]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
```

## **src/ui/react/Gates.tsx**

```
import React from "react";
import { useAuth } from "./AuthProvider.js";

export function SignedIn({ children, fallback = null }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const { loading, effective } = useAuth();
  if (loading) return null;
  return effective ? <>{children}</> : <>{fallback}</>;
}

export function SignedOut({ children }: { children: React.ReactNode }) {
  const { loading, effective } = useAuth();
  if (loading) return null;
  return !effective ? <>{children}</> : null;
}

export function InOrg({ children, fallback = null }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const { loading, effective } = useAuth();
  if (loading) return null;
  return effective?.org ? <>{children}</> : <>{fallback}</>;
}

export function Gate({ require, children, fallback = null }:{
  require?: { role?: Array<"owner"|"admin"|"member"|"viewer"> | "any"; labels?: Record<string, any>; mfa?: boolean; groupsAnyOf?: string[] };
  children: React.ReactNode; fallback?: React.ReactNode;
}) {
  const { loading, effective } = useAuth();
  if (loading) return null;
  if (!effective) return <>{fallback}</>;
  // simple checks
  if (require?.role && require.role !== "any") {
    const r = effective.membership?.role; if (!r || !require.role.includes(r)) return <>{fallback}</>;
  }
  if (require?.labels) {
    for (const [k, v] of Object.entries(require.labels)) if ((effective.labels ?? {})[k] !== v) return <>{fallback}</>;
  }
  if (require?.groupsAnyOf?.length) {
    const have = new Set(effective.groups?.map(g => g.id) ?? []);
    if (!require.groupsAnyOf.some(g => have.has(g))) return <>{fallback}</>;
  }
  if (require?.mfa && !true) return <>{fallback}</>; // wire real MFA flag later
  return <>{children}</>;
}
```

---

# **🧱 UI — Svelte (headless, Bits-UI-friendly)**

## **src/ui/svelte/auth.ts**

```
import { writable, derived } from "svelte/store";
import type { EffectiveIdentity } from "../../core/models/profile.js";

export const token = writable<string | undefined>(undefined);
export const effective = writable<EffectiveIdentity | undefined>(undefined);
export const loading = writable<boolean>(true);

export function initAuth(fetchEffective: (token?: string, orgId?: string) => Promise<EffectiveIdentity>, initialToken?: string) {
  token.set(initialToken);
  refresh(fetchEffective);
  token.subscribe(() => refresh(fetchEffective));
}

export async function refresh(fetchEffective: (t?: string, o?: string) => Promise<EffectiveIdentity>, orgId?: string) {
  loading.set(true);
  effective.set(await fetchEffective(get(token), orgId));
  loading.set(false);
}
function get<T>(store: { subscribe: (run: (v: T) => void) => () => void }): T | undefined {
  let v: any; const unsub = store.subscribe(_ => v = _); unsub(); return v;
}

export const signedIn = derived([effective, loading], ([$e, $l]) => !$l && !!$e);
export const inOrg = derived([effective, loading], ([$e, $l]) => !$l && !!$e?.org);
```

## **src/ui/svelte/Gate.svelte**

```
<script lang="ts">
  import { effective, loading } from "./auth";
  export let require: { role?: ("owner"|"admin"|"member"|"viewer")[] | "any"; labels?: Record<string, any>; groupsAnyOf?: string[]; mfa?: boolean } = {};
  export let fallback: any = null;
  let eff; let load;
  $: show = !load && eff && check(eff, require);
  function check(eff: any, req: any) {
    if (req.role && req.role !== "any") { const r = eff.membership?.role; if (!r || !req.role.includes(r)) return false; }
    if (req.labels) for (const [k,v] of Object.entries(req.labels)) if ((eff.labels ?? {})[k] !== v) return false;
    if (req.groupsAnyOf?.length) { const s = new Set((eff.groups ?? []).map((g:any)=>g.id)); if (!req.groupsAnyOf.some((g:any)=>s.has(g))) return false; }
    return true;
  }
</script>

{#if $loading}{:else}{#if show}<slot />{:else}{#if fallback}{fallback}{/if}{/if}
```

---

# **🧭 Next.js middleware helpers**

## **src/ui/next/middleware.ts**

```
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { RoutePolicyRequire } from "../../core/models/policy.js";
import type { AccessTokenClaims } from "../../core/models/session.js";

export type TokenDecoder = (req: NextRequest) => Promise<AccessTokenClaims | undefined>;
export function withAuthRoute(require: RoutePolicyRequire, decode: TokenDecoder) {
  return async function middleware(req: NextRequest) {
    const claims = await decode(req);
    if (!claims) return NextResponse.redirect(new URL("/sign-in", req.url));
    // simple checks (you can route to PoliciesPort if you want)
    if (require.role && require.role !== "any") {
      const r = claims.org?.role; if (!r || !(require.role as string[]).includes(r)) return NextResponse.redirect(new URL("/403", req.url));
    }
    if (require.mfa && !claims.session?.mfa) return NextResponse.redirect(new URL("/mfa", req.url));
    return NextResponse.next();
  };
}

export function withPublicRoute() {
  return async function middleware() { return NextResponse.next(); };
}
```

---

# **🔌 DI container — add Memberships**

Update src/di/container.ts to include memberships:

```
import { AuthentikMembershipsAdapter } from "../adapters/authentik/memberships.authentik.adapter.js";
// ...
const memberships = new AuthentikMembershipsAdapter(http);

return {
  ports: { http, apps, providers, flows, outposts, users, orgs, groups, keys, policies, profiles, memberships },
};
```

---

# **🚪 index exports — add new modules**

```
export * from "./core/models/membership.js";
export * from "./core/ports/memberships.port.js";

export * from "./features/claimsMapping.js";
export * from "./features/forwardAuthHandler.js";

export * from "./usecases/_actionTypes.js";
export * from "./usecases/memberships/addUserToOrg.js";

export * from "./ui/react/AuthProvider.js";
export * from "./ui/react/Gates.js";
export * from "./ui/svelte/auth.js";
export { default as SvelteGate } from "./ui/svelte/Gate.svelte";
export * from "./ui/next/middleware.js";
```

---

## **why this remains low-risk & insanely customizable**

- **Each file does one job**; adapters are tiny; swapping a vendor is changing 1–2 files.
- **Ports protect your usecases/features** from vendor drift.
- **UI is headless**: swap Radix/Bits-UI/theming at will; DX stays the same.
- **Dry-run/plan/apply** makes MCP actions safe for human/AI operators.

want me to keep going with: claims mapping to OIDC custom claims, proxy header templates, and a small React <SignIn /> shell wired to Authentik’s OAuth device/code flows (headless, Radix-friendly)?
