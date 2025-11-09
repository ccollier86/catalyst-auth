Awesome — here’s the next chunk of the **full client**: concrete Authentik adapters for **providers, flows, outposts, users, orgs, groups, keys, policies**, plus a tiny **env config**, **labels utility**, completed **DI container**, and a couple more **use-cases**. Everything stays single-responsibility, domain-separated, and dependency-inverted.

> You can paste these into the folders we scaffolded earlier. I’m keeping each file small and focused so it’s easy to reason about.

---

# **src/config/env.ts**

```
export type AuthKitEnv = {
  AUTHENTIK_BASE_URL: string;
  AUTHENTIK_TOKEN: string;
  AUTHKIT_ISSUER?: string;
  AUTHKIT_AUDIENCE?: string;
  AUTHKIT_JWK_PRIVATE?: string; // JWK JSON string, if using decision JWT
};

export function loadEnv(get: (k: string) => string | undefined = (k) => process.env[k]): AuthKitEnv {
  const cfg: AuthKitEnv = {
    AUTHENTIK_BASE_URL: required("AUTHENTIK_BASE_URL"),
    AUTHENTIK_TOKEN: required("AUTHENTIK_TOKEN"),
    AUTHKIT_ISSUER: get("AUTHKIT_ISSUER"),
    AUTHKIT_AUDIENCE: get("AUTHKIT_AUDIENCE"),
    AUTHKIT_JWK_PRIVATE: get("AUTHKIT_JWK_PRIVATE"),
  };
  return cfg;

  function required(k: string) {
    const v = get(k);
    if (!v) throw new Error(`Missing required env ${k}`);
    return v;
  }
}
```

---

# **Adapters — Authentik HTTP mappers**

> These map Authentik’s REST API to our ports. We rely on our HttpPort (already implemented by FetchHttpAdapter).

## **src/adapters/authentik/providers.authentik.adapter.ts**

```
import { ProvidersPort, ProviderRef } from "../../core/ports/providers.port.js";
import { HttpPort } from "../../core/ports/http.port.js";

export class AuthentikProvidersAdapter implements ProvidersPort {
  constructor(private http: HttpPort) {}

  async createProxy(input: { appId: string; mode: "forward-auth"|"single-app"; headerMap?: Record<string,string> }): Promise<ProviderRef> {
    const res = await this.http.post<any>("/api/v3/providers/proxy/", {
      name: `proxy-${input.appId}-${Date.now()}`,
      authorization_flow: null, // will be bound via flows adapter
      mode: input.mode === "forward-auth" ? "forward_single" : "proxy",
      assigned_application: input.appId,
      inject_headers: input.headerMap ?? {},
    });
    return { id: res?.pk ?? res?.id, kind: "proxy", name: res?.name, appId: res?.assigned_application };
  }

  async createOIDC(input: { appId: string; name: string; redirectUris: string[]; scopes?: string[]; claims?: Record<string,string> }): Promise<ProviderRef> {
    const res = await this.http.post<any>("/api/v3/providers/oauth2provider/", {
      name: input.name,
      client_type: "confidential",
      authorization_flow: null, // bind later
      redirect_uris: input.redirectUris.join("\n"),
      scope: (input.scopes ?? ["openid","profile","email"]).join(" "),
      assigned_application: input.appId,
      // extra claims via mapping (left for policies/claims adapter if you want to extend)
    });
    return { id: res?.pk ?? res?.id, kind: "oidc", name: res?.name, appId: res?.assigned_application };
  }

  async attachToApp(providerId: string, appId: string): Promise<void> {
    await this.http.patch(`/api/v3/providers/all/${providerId}/`, { assigned_application: appId });
  }
}
```

## **src/adapters/authentik/flows.authentik.adapter.ts**

```
import { FlowsPort, FlowRef } from "../../core/ports/flows.port.js";
import { HttpPort } from "../../core/ports/http.port.js";

export class AuthentikFlowsAdapter implements FlowsPort {
  constructor(private http: HttpPort) {}

  async ensureLoginFlow(input: { name: string; mfa?: boolean }): Promise<FlowRef> {
    // Try to find existing
    const list = await this.http.get<{ results: any[] }>("/api/v3/flows/flow/?slug=" + encodeURIComponent(slugify(input.name)));
    if (list.results?.length) {
      const f = list.results[0];
      // Optionally ensure MFA stage is present; omitted for brevity
      return { id: f?.pk ?? f?.id, slug: f?.slug, kind: f?.designation ?? "authentication" };
    }
    const res = await this.http.post<any>("/api/v3/flows/flow/", {
      name: input.name,
      slug: slugify(input.name),
      designation: "authentication",
      layout: "stacked",
    });
    // NOTE: adding MFA stage would be a separate call to /stages/totp/ or webauthn stages and binding to this flow
    return { id: res?.pk ?? res?.id, slug: res?.slug, kind: res?.designation ?? "authentication" };
  }

  async bindProvider(flowId: string, providerId: string): Promise<void> {
    // For OAuth/Proxy Provider, set authorization_flow to this flow
    await this.http.patch(`/api/v3/providers/all/${providerId}/`, { authorization_flow: flowId });
  }
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 64);
}
```

## **src/adapters/authentik/outposts.authentik.adapter.ts**

```
import { OutpostsPort, OutpostRef } from "../../core/ports/outposts.port.js";
import { HttpPort } from "../../core/ports/http.port.js";

export class AuthentikOutpostsAdapter implements OutpostsPort {
  constructor(private http: HttpPort) {}

  async list(): Promise<OutpostRef[]> {
    const res = await this.http.get<{ results: any[] }>("/api/v3/outposts/instances/");
    return (res.results ?? []).map((o) => ({ id: o?.pk ?? o?.id, name: o?.name, status: this.status(o) }));
  }

  async attach(providerId: string, outpostId: string): Promise<void> {
    // Assign provider to outpost's "managed providers" list
    const outpost = await this.http.get<any>(`/api/v3/outposts/instances/${outpostId}/`);
    const managed = new Set<string>(outpost?.managed_providers ?? []);
    managed.add(providerId);
    await this.http.patch(`/api/v3/outposts/instances/${outpostId}/`, { managed_providers: Array.from(managed) });
  }

  async health(outpostId: string): Promise<OutpostRef> {
    const o = await this.http.get<any>(`/api/v3/outposts/instances/${outpostId}/`);
    return { id: o?.pk ?? o?.id, name: o?.name, status: this.status(o) };
  }

  private status(o: any): OutpostRef["status"] {
    if (o?.last_seen && Date.now() - new Date(o.last_seen).getTime() < 2 * 60 * 1000) return "healthy";
    return "degraded";
  }
}
```

## **src/adapters/authentik/users.authentik.adapter.ts**

```
import { UsersPort } from "../../core/ports/users.port.js";
import { User } from "../../core/models/user.js";
import { HttpPort } from "../../core/ports/http.port.js";

export class AuthentikUsersAdapter implements UsersPort {
  constructor(private http: HttpPort) {}
  async get(id: string): Promise<User> {
    const u = await this.http.get<any>(`/api/v3/core/users/${id}/`);
    return {
      id: u?.pk ?? u?.id ?? id,
      email: u?.email,
      emailVerified: !!u?.is_active, // authentik flags differ; adjust if needed
      status: u?.is_active ? "active" : "disabled",
      labels: u?.attributes?.labels ?? {},
      metadata: u?.attributes?.metadata ?? {},
      createdAt: u?.created,
      updatedAt: u?.modified,
      profile: this.mapProfile(u?.attributes?.profile),
    };
  }
  async update(id: string, patch: Partial<User>): Promise<User> {
    // Store profile/labels/metadata under attributes
    const body: any = {};
    if (patch.email !== undefined) body.email = patch.email;
    body.attributes = {
      ...(patch.labels ? { labels: patch.labels } : {}),
      ...(patch.metadata ? { metadata: patch.metadata } : {}),
      ...(patch.profile ? { profile: patch.profile } : {}),
    };
    const u = await this.http.patch<any>(`/api/v3/core/users/${id}/`, body);
    return this.get(u?.pk ?? u?.id ?? id);
  }

  private mapProfile(p?: any): User["profile"] {
    if (!p) return {};
    return p;
  }
}
```

## **src/adapters/authentik/orgs.authentik.adapter.ts**

```
import { OrgsPort } from "../../core/ports/orgs.port.js";
import { Org } from "../../core/models/org.js";
import { HttpPort } from "../../core/ports/http.port.js";

/**
 * Authentik doesn’t have “orgs/tenants” as first-class; we map them to Groups (or Applications) + attributes.
 * This adapter assumes you store Org records in attributes of a special Group (slug = org slug).
 */
export class AuthentikOrgsAdapter implements OrgsPort {
  constructor(private http: HttpPort) {}

  async get(idOrSlug: string): Promise<Org> {
    // Try by slug via groups endpoint
    const res = await this.http.get<{ results: any[] }>(`/api/v3/core/groups/?slug=${encodeURIComponent(idOrSlug)}`);
    const g = res.results?.[0] ?? await this.http.get<any>(`/api/v3/core/groups/${idOrSlug}/`);
    const attrs = g?.attributes ?? {};
    const profile = attrs.profile ?? { displayName: g?.name ?? idOrSlug };
    return {
      id: g?.pk ?? g?.id ?? idOrSlug,
      slug: g?.slug ?? idOrSlug,
      profile,
      labels: attrs.labels ?? {},
      settings: attrs.settings ?? {},
      metadata: attrs.metadata ?? {},
      createdAt: g?.created,
      updatedAt: g?.modified,
    };
  }

  async create(input: { slug: string; profile: Org["profile"] }): Promise<Org> {
    const res = await this.http.post<any>("/api/v3/core/groups/", {
      name: input.profile.displayName ?? input.slug,
      slug: input.slug,
      attributes: { profile: input.profile, labels: {}, settings: {}, metadata: {} },
    });
    return this.get(res?.pk ?? res?.id);
  }

  async update(id: string, patch: Partial<Org>): Promise<Org> {
    const current = await this.get(id);
    const attrs = {
      profile: patch.profile ?? current.profile,
      labels: patch.labels ?? current.labels ?? {},
      settings: patch.settings ?? current.settings ?? {},
      metadata: patch.metadata ?? current.metadata ?? {},
    };
    await this.http.patch(`/api/v3/core/groups/${current.id}/`, {
      name: (attrs.profile as any)?.displayName ?? current.slug,
      attributes: attrs,
    });
    return this.get(current.id);
  }
}
```

## **src/adapters/authentik/groups.authentik.adapter.ts**

```
import { GroupsPort } from "../../core/ports/groups.port.js";
import { Group } from "../../core/models/group.js";
import { HttpPort } from "../../core/ports/http.port.js";

export class AuthentikGroupsAdapter implements GroupsPort {
  constructor(private http: HttpPort) {}

  async list(orgId: string): Promise<Group[]> {
    // We model org as a Group; sub-groups under it = departments
    const res = await this.http.get<{ results: any[] }>(`/api/v3/core/groups/?parent=${encodeURIComponent(orgId)}`);
    return (res.results ?? []).map((g) => ({
      id: g?.pk ?? g?.id, orgId, name: g?.name, slug: g?.slug, description: g?.attributes?.description,
      labels: g?.attributes?.labels ?? {}, metadata: g?.attributes?.metadata ?? {},
    }));
  }

  async create(input: { orgId: string; name: string; slug: string; labels?: Record<string, string|boolean> }): Promise<Group> {
    const res = await this.http.post<any>("/api/v3/core/groups/", {
      name: input.name, slug: input.slug, parent: input.orgId,
      attributes: { labels: input.labels ?? {} }
    });
    return { id: res?.pk ?? res?.id, orgId: input.orgId, name: input.name, slug: input.slug, labels: input.labels ?? {} };
  }

  async addMember(groupId: string, userId: string): Promise<void> {
    // Authentik group membership: PATCH group members; the API expects user PKs
    await this.http.post(`/api/v3/core/groups/${groupId}/members/`, { user: userId });
  }
}
```

## **src/adapters/authentik/keys.authentik.adapter.ts**

```
import { KeysPort } from "../../core/ports/keys.port.js";
import { ApiKey } from "../../core/models/key.js";
import { HttpPort } from "../../core/ports/http.port.js";

/**
 * Authentik supports API tokens; we map to our ApiKey interface.
 * Adjust endpoints if your instance uses token endpoints under /api/v3/core/tokens/
 */
export class AuthentikKeysAdapter implements KeysPort {
  constructor(private http: HttpPort) {}

  async issue(input: { owner: { type:"user"|"org"; id:string }; scopes?: string[]; labels?: Record<string,string|boolean>; ttlSec?: number }): Promise<ApiKey> {
    const res = await this.http.post<any>("/api/v3/core/tokens/", {
      identifier: `key-${input.owner.type}-${input.owner.id}-${Date.now()}`,
      intent: "api",  // depends on authentik’s token model
      expires: input.ttlSec ? new Date(Date.now() + input.ttlSec * 1000).toISOString() : null,
      // store scopes/labels in attributes
      attributes: { owner: input.owner, scopes: input.scopes ?? [], labels: input.labels ?? {} },
    });
    return {
      id: res?.pk ?? res?.id,
      owner: input.owner,
      scopes: input.scopes ?? [],
      labels: input.labels ?? {},
      expiresAt: res?.expires ?? null,
      createdAt: res?.created,
    };
  }

  async revoke(id: string): Promise<void> {
    await this.http.del(`/api/v3/core/tokens/${id}/`);
  }

  async exchange(apiKey: string): Promise<{ accessToken: string; expiresIn: number }> {
    // If authentik supports exchanging API tokens to OAuth app tokens, call the respective endpoint.
    // Placeholder: return a bearer of the same token with short expiration (you can add your exchange server later)
    return { accessToken: apiKey, expiresIn: 300 };
  }
}
```

## **src/adapters/authentik/policies.authentik.adapter.ts**

```
import { PoliciesPort } from "../../core/ports/policies.port.js";
import { RoutePolicyRequire, PolicyDecision } from "../../core/models/policy.js";
import { AccessTokenClaims } from "../../core/models/session.js";

/**
 * Simple local evaluation adapter; if you want to use authentik policies proper,
 * wire an evaluator to authentik's policy endpoints and map to PolicyDecision shape.
 */
export class LocalPoliciesAdapter implements PoliciesPort {
  async evaluate(require: RoutePolicyRequire, token: AccessTokenClaims): Promise<PolicyDecision> {
    const reasons: string[] = [];
    // role
    if (require.role && require.role !== "any") {
      const allowed = new Set(require.role);
      const role = token.org?.role;
      if (!role || !allowed.has(role)) reasons.push("role_not_allowed");
    }
    // labels
    if (require.labels) {
      for (const [k, v] of Object.entries(require.labels)) {
        if ((token.labels ?? {})[k] !== v) reasons.push(`label_${k}_mismatch`);
      }
    }
    // MFA
    if (require.mfa && !token.session?.mfa) reasons.push("mfa_required");
    // scopes
    if (require.scopes && require.scopes.length) {
      const s = new Set(token.scopes ?? []);
      for (const req of require.scopes) if (!s.has(req)) reasons.push(`missing_scope_${req}`);
    }
    // groups
    if (require.groupsAnyOf && require.groupsAnyOf.length) {
      const g = new Set(token.groups ?? []);
      if (!require.groupsAnyOf.some((x) => g.has(x))) reasons.push("group_mismatch");
    }

    return { allow: reasons.length === 0, reasons: reasons.length ? reasons : undefined };
  }
}
```

---

# **Features — labels util (merge)**

## **src/features/labels.ts**

```
type Dict = Record<string, string | boolean | number | null | undefined>;

export function mergeLabels(...sets: Array<Dict | undefined>): Record<string, string|boolean|number> {
  const out: Record<string, string|boolean|number> = {};
  for (const s of sets) {
    if (!s) continue;
    for (const [k, v] of Object.entries(s)) {
      if (v === undefined || v === null) continue;
      out[k] = v as any;
    }
  }
  return out;
}
```

---

# **Use-cases — more workflows**

## **src/usecases/provisionOIDCApp.ts**

```
import { AppsPort } from "../core/ports/apps.port.js";
import { ProvidersPort } from "../core/ports/providers.port.js";
import { FlowsPort } from "../core/ports/flows.port.js";
import { OutpostsPort } from "../core/ports/outposts.port.js";

export async function provisionOIDCApp(
  ports: { apps: AppsPort; providers: ProvidersPort; flows: FlowsPort; outposts: OutpostsPort },
  input: { name: string; slug?: string; outpostId?: string; redirectUris: string[]; scopes?: string[]; claims?: Record<string,string>; mfa?: boolean }
) {
  const app = await ports.apps.create({ name: input.name, slug: input.slug });
  const flow = await ports.flows.ensureLoginFlow({ name: `${input.name}-login`, mfa: !!input.mfa });
  const provider = await ports.providers.createOIDC({ appId: app.id, name: `${input.name}-oidc`, redirectUris: input.redirectUris, scopes: input.scopes, claims: input.claims });
  await ports.flows.bindProvider(flow.id, provider.id);
  if (input.outpostId) await ports.outposts.attach(provider.id, input.outpostId);
  return { app, provider, flow };
}
```

## **src/usecases/applyBlueprint.ts (stub you can flesh out)**

```
import { HttpPort } from "../core/ports/http.port.js";

/**
 * If you keep blueprints, Authentik exposes import endpoints.
 * Here we accept YAML as string (template rendered elsewhere) and POST it.
 */
export async function applyBlueprint(http: HttpPort, yaml: string): Promise<{ applied: boolean }> {
  // Example endpoint (adjust to your instance): /api/v3/blueprints/
  await http.post("/api/v3/blueprints/", { body: yaml }); // may need multipart or specific field name
  return { applied: true };
}
```

## **src/usecases/outpostDoctor.ts**

```
import { OutpostsPort } from "../core/ports/outposts.port.js";

export async function outpostDoctor(outposts: OutpostsPort, outpostId: string) {
  const h = await outposts.health(outpostId);
  const ok = h.status === "healthy";
  return { ok, details: h };
}
```

---

# **DI container — completed wiring**

## **src/di/container.ts**

```
import { FetchHttpAdapter } from "../adapters/http/fetch.http.adapter.js";
import { AuthentikAppsAdapter } from "../adapters/authentik/apps.authentik.adapter.js";
import { AuthentikProvidersAdapter } from "../adapters/authentik/providers.authentik.adapter.js";
import { AuthentikFlowsAdapter } from "../adapters/authentik/flows.authentik.adapter.js";
import { AuthentikOutpostsAdapter } from "../adapters/authentik/outposts.authentik.adapter.js";
import { AuthentikUsersAdapter } from "../adapters/authentik/users.authentik.adapter.js";
import { AuthentikOrgsAdapter } from "../adapters/authentik/orgs.authentik.adapter.ts";
import { AuthentikGroupsAdapter } from "../adapters/authentik/groups.authentik.adapter.js";
import { AuthentikKeysAdapter } from "../adapters/authentik/keys.authentik.adapter.js";
import { LocalPoliciesAdapter } from "../adapters/authentik/policies.authentik.adapter.js";
import { OverlayProfilesAdapter } from "../adapters/overlay/profiles.overlay.adapter.js";

export function buildAuthKit(config: { authentikBaseUrl: string; authentikToken: string }) {
  const http = new FetchHttpAdapter(config.authentikBaseUrl, {
    Authorization: `Bearer ${config.authentikToken}`,
  });

  const apps = new AuthentikAppsAdapter(http);
  const providers = new AuthentikProvidersAdapter(http);
  const flows = new AuthentikFlowsAdapter(http);
  const outposts = new AuthentikOutpostsAdapter(http);
  const users = new AuthentikUsersAdapter(http);
  const orgs = new AuthentikOrgsAdapter(http);
  const groups = new AuthentikGroupsAdapter(http);
  const keys = new AuthentikKeysAdapter(http);
  const policies = new LocalPoliciesAdapter();
  const profiles = new OverlayProfilesAdapter();

  return {
    ports: { http, apps, providers, flows, outposts, users, orgs, groups, keys, policies, profiles },
  };
}
```

> If your environment treats orgs as Groups, this wiring is ready. If you later store orgs elsewhere, swap the OrgsPort adapter and nothing else changes.

---

# **src/index.ts (export the new pieces)**

```
export * from "./config/env.js";

export * from "./core/models/common.js";
export * from "./core/models/user.js";
export * from "./core/models/org.js";
export * from "./core/models/group.js";
export * from "./core/models/profile.js";
export * from "./core/models/key.js";
export * from "./core/models/session.js";
export * from "./core/models/policy.js";

export * from "./core/ports/apps.port.js";
export * from "./core/ports/providers.port.js";
export * from "./core/ports/flows.port.js";
export * from "./core/ports/outposts.port.js";
export * from "./core/ports/users.port.js";
export * from "./core/ports/orgs.port.js";
export * from "./core/ports/groups.port.js";
export * from "./core/ports/profiles.port.js";
export * from "./core/ports/keys.port.js";
export * from "./core/ports/policies.port.js";
export * from "./core/ports/forwardauth.port.js";
export * from "./core/ports/http.port.js";

export * from "./features/effectiveIdentity.js";
export * from "./features/forwardAuth.js";
export * from "./features/decisionJwt.js";
export * from "./features/labels.js";

export * from "./usecases/provisionForwardAuthApp.js";
export * from "./usecases/provisionOIDCApp.js";
export * from "./usecases/applyBlueprint.js";
export * from "./usecases/outpostDoctor.js";

export * from "./di/container.js";
```

---

## **What’s next (if you want me to keep going)**

- Fill in **Users/Orgs membership management** (if you want explicit membership CRUD beyond Groups).
- Add a **claims/headers mapping** helper to push profile/labels into OIDC/Proxy outputs.
- Add **Valibot** schemas in the _UI/API layer_ (not here) for handler validation.
- Ship **Radix/Bits-UI headless components** that call these ports (SignIn, OrgSwitcher, Profile forms, etc.).
- Add **dry-run/plan/apply** scaffolding around use-cases for AI-MCP.

Say the word and I’ll continue with membership helpers, header/claim mapping utilities, and a first pass at the headless <SignIn /> container (React + Svelte flavors).
