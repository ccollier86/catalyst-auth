# **Folder tree**

```
@catalyst/authkit/
├─ package.json
├─ tsconfig.json
├─ .env.example
├─ src/
│  ├─ index.ts
│  ├─ config/
│  │  └─ env.ts
│  ├─ core/                     # domain: pure types + ports (no libs)
│  │  ├─ models/
│  │  │  ├─ common.ts
│  │  │  ├─ user.ts
│  │  │  ├─ org.ts
│  │  │  ├─ group.ts
│  │  │  ├─ profile.ts
│  │  │  ├─ key.ts
│  │  │  ├─ session.ts
│  │  │  └─ policy.ts
│  │  └─ ports/
│  │     ├─ apps.port.ts
│  │     ├─ providers.port.ts
│  │     ├─ flows.port.ts
│  │     ├─ outposts.port.ts
│  │     ├─ users.port.ts
│  │     ├─ orgs.port.ts
│  │     ├─ groups.port.ts
│  │     ├─ profiles.port.ts
│  │     ├─ keys.port.ts
│  │     ├─ policies.port.ts
│  │     ├─ forwardauth.port.ts
│  │     └─ http.port.ts
│  ├─ adapters/                 # I/O edges (Authéntik HTTP, overlay stores)
│  │  ├─ http/
│  │  │  └─ fetch.http.adapter.ts
│  │  ├─ authentik/
│  │  │  ├─ apps.authentik.adapter.ts
│  │  │  ├─ providers.authentik.adapter.ts
│  │  │  ├─ flows.authentik.adapter.ts
│  │  │  ├─ outposts.authentik.adapter.ts
│  │  │  ├─ users.authentik.adapter.ts
│  │  │  ├─ orgs.authentik.adapter.ts
│  │  │  ├─ groups.authentik.adapter.ts
│  │  │  ├─ keys.authentik.adapter.ts
│  │  │  └─ policies.authentik.adapter.ts
│  │  └─ overlay/
│  │     └─ profiles.overlay.adapter.ts
│  ├─ features/                 # extras (pure orchestrations over ports)
│  │  ├─ effectiveIdentity.ts
│  │  ├─ labels.ts
│  │  ├─ decisionJwt.ts
│  │  └─ forwardAuth.ts
│  ├─ usecases/                 # dev workflows (MCP-ready, dry-run friendly)
│  │  ├─ provisionForwardAuthApp.ts
│  │  ├─ provisionOIDCApp.ts
│  │  ├─ applyBlueprint.ts
│  │  └─ outpostDoctor.ts
│  └─ di/
│     └─ container.ts
```

---

## **package.json**

```
{
  "name": "@catalyst/authkit",
  "version": "0.0.1",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "check": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "undici": "^6.19.8",
    "jose": "^5.9.3"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "@types/node": "^22.8.6",
    "vitest": "^2.1.3"
  }
}
```

## **tsconfig.json**

```
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

## **.env.example**

```
AUTHENTIK_BASE_URL=https://auth.example.com
AUTHENTIK_TOKEN=api_xxx   # or client credentials if you prefer
AUTHKIT_ISSUER=https://authkit.example.com
AUTHKIT_AUDIENCE=catalyst
AUTHKIT_JWK_PRIVATE=...   # PEM or JWK JSON (for decision JWT signing)
```

---

# **Core domain (pure types)**

### **src/core/models/common.ts**

```
export type Result<T> = { ok: true; value: T } | { ok: false; error: InfraError };
export class InfraError extends Error {
  constructor(public code: string, message: string, public cause?: unknown) { super(message); }
}
export interface Page<T> { items: T[]; nextCursor?: string | null; }
```

### **src/core/models/user.ts**

```
export interface UserCore { id: string; email: string; emailVerified?: boolean; status?: "active"|"invited"|"disabled"; }
export interface UserProfile {
  name?: { given?: string; family?: string; display?: string };
  avatarUrl?: string;
  phone?: string;
  pronouns?: string;
  bio?: string;
  links?: Array<{ label: string; url: string }>;
  timezone?: string;
  locale?: string;
  address?: { line1: string; line2?: string; city: string; region: string; postal: string; country: string };
  company?: { name?: string; title?: string };
}
export interface User extends UserCore {
  profile?: UserProfile;
  labels?: Record<string, string|boolean>;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}
```

### **src/core/models/org.ts**

```
export interface OrgCore { id: string; slug: string; status?: "active"|"suspended"; ownerUserId?: string; }
export interface OrgProfile {
  displayName: string;
  legalName?: string;
  logoUrl?: string;
  description?: string;
  website?: string;
  links?: Array<{ label: string; url: string }>;
  address?: { line1: string; line2?: string; city: string; region: string; postal: string; country: string };
  brand?: { primaryColor?: string; secondaryColor?: string; faviconUrl?: string };
}
export interface Org extends OrgCore {
  profile?: OrgProfile;
  labels?: Record<string, string|boolean>;
  settings?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}
```

### **src/core/models/group.ts**

```
export interface Group { id: string; orgId: string; name: string; slug: string; description?: string;
  labels?: Record<string, string|boolean>; metadata?: Record<string, unknown>; }
```

### **src/core/models/profile.ts**

```
export interface EffectiveIdentity {
  user: import("./user.js").User;
  org?: import("./org.js").Org;
  groups?: Array<import("./group.js").Group>;
  membership?: { role: "owner"|"admin"|"member"|"viewer"; labelsDelta?: Record<string, string|boolean>; status?: "active"|"invited"|"suspended" };
  labels?: Record<string, string|boolean>;
  // optional plan/entitlements you may add later
  plan?: string;
  entitlements?: { features?: Record<string, boolean>; limits?: Record<string, number> };
  gates?: Record<string, unknown>;
}
```

### **src/core/models/key.ts**

```
export interface ApiKey {
  id: string;
  owner: { type: "user"|"org"; id: string };
  scopes?: string[];
  labels?: Record<string, string|boolean>;
  expiresAt?: string | null;
  createdAt?: string;
}
```

### **src/core/models/session.ts**

```
export interface AccessTokenClaims {
  iss: string; aud: string | string[]; sub: string; exp: number; iat: number;
  session?: { id: string; mfa?: boolean; amr?: string[] };
  org?: { id: string; slug: string; role: "owner"|"admin"|"member"|"viewer" };
  groups?: string[];
  labels?: Record<string, string|boolean>;
  plan?: string;
  ent?: { f?: Record<string, boolean>; l?: Record<string, number> };
  scopes?: string[];
}
```

### **src/core/models/policy.ts**

```
export interface RoutePolicyRequire {
  role?: Array<"owner"|"admin"|"member"|"viewer"> | "any";
  labels?: Record<string, string|boolean>;
  mfa?: boolean;
  scopes?: string[];
  groupsAnyOf?: string[];
}
export interface PolicyDecision { allow: boolean; reasons?: string[]; obligations?: Record<string, unknown>; }
```

---

# **Ports (interfaces = dependency inversion)**

### **src/core/ports/http.port.ts**

```
export interface HttpPort {
  get<T>(path: string, query?: Record<string, string|number|boolean|undefined>): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
}
```

### **src/core/ports/apps.port.ts**

```
export interface AppRef { id: string; name: string; slug?: string; }
export interface AppsPort {
  list(): Promise<AppRef[]>;
  create(input: { name: string; slug?: string; description?: string }): Promise<AppRef>;
  delete(id: string): Promise<void>;
}
```

### **src/core/ports/providers.port.ts**

```
export type ProviderKind = "proxy" | "oidc" | "saml";
export interface ProviderRef { id: string; kind: ProviderKind; name: string; appId?: string; }
export interface ProvidersPort {
  createProxy(input: { appId: string; mode: "forward-auth"|"single-app"; headerMap?: Record<string,string> }): Promise<ProviderRef>;
  createOIDC(input: { appId: string; name: string; redirectUris: string[]; scopes?: string[]; claims?: Record<string,string> }): Promise<ProviderRef>;
  attachToApp(providerId: string, appId: string): Promise<void>;
}
```

### **src/core/ports/flows.port.ts**

```
export interface FlowRef { id: string; slug: string; kind: "authentication"|"authorization"; }
export interface FlowsPort {
  ensureLoginFlow(input: { name: string; mfa?: boolean }): Promise<FlowRef>;
  bindProvider(flowId: string, providerId: string): Promise<void>;
}
```

### **src/core/ports/outposts.port.ts**

```
export interface OutpostRef { id: string; name: string; status?: "healthy"|"degraded"|"down"; }
export interface OutpostsPort {
  list(): Promise<OutpostRef[]>;
  attach(providerId: string, outpostId: string): Promise<void>;
  health(outpostId: string): Promise<OutpostRef>;
}
```

### **src/core/ports/users.port.ts**

```
import { User } from "../models/user.js";
export interface UsersPort {
  get(id: string): Promise<User>;
  update(id: string, patch: Partial<User>): Promise<User>;
}
```

### **src/core/ports/orgs.port.ts**

```
import { Org } from "../models/org.js";
export interface OrgsPort {
  get(idOrSlug: string): Promise<Org>;
  create(input: { slug: string; profile: Org["profile"] }): Promise<Org>;
  update(id: string, patch: Partial<Org>): Promise<Org>;
}
```

### **src/core/ports/groups.port.ts**

```
import { Group } from "../models/group.js";
export interface GroupsPort {
  list(orgId: string): Promise<Group[]>;
  create(input: { orgId: string; name: string; slug: string; labels?: Record<string, string|boolean> }): Promise<Group>;
  addMember(groupId: string, userId: string): Promise<void>;
}
```

### **src/core/ports/profiles.port.ts**

```
import { User, Org } from "../models/index.js";
export interface ProfilesPort {
  getUserProfile(userId: string): Promise<User["profile"]>;
  updateUserProfile(userId: string, profile: User["profile"]): Promise<User["profile"]>;
  getOrgProfile(orgId: string): Promise<Org["profile"]>;
  updateOrgProfile(orgId: string, profile: Org["profile"]): Promise<Org["profile"]>;
}
```

### **src/core/ports/keys.port.ts**

```
import { ApiKey } from "../models/key.js";
export interface KeysPort {
  issue(input: { owner: { type:"user"|"org"; id:string }; scopes?: string[]; labels?: Record<string,string|boolean>; ttlSec?: number }): Promise<ApiKey>;
  revoke(id: string): Promise<void>;
  exchange(apiKey: string): Promise<{ accessToken: string; expiresIn: number }>;
}
```

### **src/core/ports/policies.port.ts**

```
import { PolicyDecision, RoutePolicyRequire } from "../models/policy.js";
import { AccessTokenClaims } from "../models/session.js";
export interface PoliciesPort {
  evaluate(require: RoutePolicyRequire, token: AccessTokenClaims): Promise<PolicyDecision>;
}
```

### **src/core/ports/forwardauth.port.ts**

```
import { AccessTokenClaims } from "../models/session.js";
export interface ForwardAuthPort {
  headersFor(token: AccessTokenClaims): Record<string, string>;
  traefikSnippet(opts: { domain: string; mode: "single-app"|"domain-level"; forwardAuthUrl: string; trustHeaders?: string[] }): string;
  decisionJwt(token: AccessTokenClaims, ttlSec?: number): Promise<string>;
}
```

> That’s the inversion: **usecases depend on these ports**, not on Authentik or fetch.

---

# **Adapters (examples)**

### **src/adapters/http/fetch.http.adapter.ts**

```
import { HttpPort } from "../../core/ports/http.port.js";

export class FetchHttpAdapter implements HttpPort {
  constructor(private baseUrl: string, private headers: Record<string, string>) {}
  private u(p: string) { return `${this.baseUrl}${p}`; }
  async get<T>(path: string, query?: Record<string, any>): Promise<T> {
    const url = new URL(this.u(path));
    Object.entries(query ?? {}).forEach(([k,v]) => v!==undefined && url.searchParams.set(k, String(v)));
    const r = await fetch(url, { headers: this.headers });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json() as Promise<T>;
  }
  async post<T>(path: string, body?: unknown): Promise<T> {
    const r = await fetch(this.u(path), { method:"POST", headers: { ...this.headers, "Content-Type":"application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json() as Promise<T>;
  }
  async put<T>(path: string, body?: unknown): Promise<T> { /* similar */ return this.post<T>(path, body); }
  async patch<T>(path: string, body?: unknown): Promise<T> { /* similar */ return this.post<T>(path, body); }
  async del<T>(path: string): Promise<T> {
    const r = await fetch(this.u(path), { method:"DELETE", headers: this.headers });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return (await r.text()) as unknown as T;
  }
}
```

### **src/adapters/authentik/apps.authentik.adapter.ts**

```
import { AppsPort, AppRef } from "../../core/ports/apps.port.js";
import { HttpPort } from "../../core/ports/http.port.js";

export class AuthentikAppsAdapter implements AppsPort {
  constructor(private http: HttpPort) {}
  async list(): Promise<AppRef[]> {
    const res = await this.http.get<{ results: any[] }>("/api/v3/apps/applications/");
    return res.results.map(a => ({ id: a.pk ?? a.id, name: a.name, slug: a.slug }));
  }
  async create(input: { name: string; slug?: string; description?: string }): Promise<AppRef> {
    const res = await this.http.post<any>("/api/v3/apps/applications/", { name: input.name, slug: input.slug, meta_description: input.description });
    return { id: res.pk ?? res.id, name: res.name, slug: res.slug };
  }
  async delete(id: string): Promise<void> {
    await this.http.del(`/api/v3/apps/applications/${id}/`);
  }
}
```

_(Do the same pattern for providers, flows, outposts, users, orgs, groups, keys, policies. Each file: single responsibility.)_

### **src/adapters/overlay/profiles.overlay.adapter.ts**

```
import { ProfilesPort } from "../../core/ports/profiles.port.js";
import { User, Org } from "../../core/models/index.js";

export class OverlayProfilesAdapter implements ProfilesPort {
  // v0: in-memory map (replace with your store)
  private users = new Map<string, User["profile"]>();
  private orgs  = new Map<string, Org["profile"]>();
  async getUserProfile(userId: string){ return this.users.get(userId) ?? {}; }
  async updateUserProfile(userId: string, profile: User["profile"]){ this.users.set(userId, profile); return profile; }
  async getOrgProfile(orgId: string){ return this.orgs.get(orgId) ?? { displayName: "" }; }
  async updateOrgProfile(orgId: string, profile: Org["profile"]){ this.orgs.set(orgId, profile); return profile; }
}
```

---

# **Features (extras)**

### **src/features/effectiveIdentity.ts**

```
import { EffectiveIdentity } from "../core/models/profile.js";
import { UsersPort } from "../core/ports/users.port.js";
import { OrgsPort } from "../core/ports/orgs.port.js";
import { GroupsPort } from "../core/ports/groups.port.js";

export async function getEffectiveIdentity(ports: {
  users: UsersPort; orgs: OrgsPort; groups: GroupsPort;
}, input: { userId: string; orgId?: string }): Promise<EffectiveIdentity> {
  const user = await ports.users.get(input.userId);
  if (!input.orgId) return { user, labels: user.labels ?? {} };
  const org = await ports.orgs.get(input.orgId);
  const groups = await ports.groups.list(org.id);
  // v0: membership lookup & label merge would go here; for now minimal:
  const labels = { ...(user.labels ?? {}), ...(org.labels ?? {}) };
  return { user, org, groups, labels };
}
```

### **src/features/decisionJwt.ts**

```
import { SignJWT, importJWK, JWTPayload } from "jose";
import { AccessTokenClaims } from "../core/models/session.js";

export async function mintDecisionJWT(token: AccessTokenClaims, opts: {
  issuer: string; audience: string; ttlSec?: number; jwk: any;
}): Promise<string> {
  const key = await importJWK(opts.jwk, "RS256");
  const payload: JWTPayload = { sub: token.sub, org: token.org, labels: token.labels };
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(opts.issuer).setAudience(opts.audience)
    .setIssuedAt().setExpirationTime(`${opts.ttlSec ?? 60}s`)
    .sign(key);
}
```

### **src/features/forwardAuth.ts**

```
import { AccessTokenClaims } from "../core/models/session.js";

export function headersFor(token: AccessTokenClaims): Record<string, string> {
  const h: Record<string, string> = {
    "X-User-Sub": token.sub,
    ...(token.org ? { "X-Org-Id": token.org.id, "X-Org-Role": token.org.role } : {})
  };
  if (token.labels) h["X-Labels"] = Buffer.from(JSON.stringify(token.labels)).toString("base64url");
  if (token.scopes) h["X-Scopes"] = token.scopes.join(",");
  return h;
}

export function traefikSnippet(opts: { domain: string; mode: "single-app"|"domain-level"; forwardAuthUrl: string; trustHeaders?: string[] }) {
  return `
- "traefik.http.routers.${opts.domain}.rule=Host(\`${opts.domain}\`)"
- "traefik.http.routers.${opts.domain}.middlewares=${opts.domain}-fa"
- "traefik.http.middlewares.${opts.domain}-fa.forwardauth.address=${opts.forwardAuthUrl}"
- "traefik.http.middlewares.${opts.domain}-fa.forwardauth.trustForwardHeader=true"
${(opts.trustHeaders ?? ["X-User-Sub","X-Org-Id","X-Org-Role","X-Labels","X-Scopes"])
  .map(h => `- "traefik.http.middlewares.${opts.domain}-fa.forwardauth.authResponseHeaders=${h}"`).join("\n")}
`.trim();
}
```

---

# **Use-cases (MCP-friendly workflows)**

### **src/usecases/provisionForwardAuthApp.ts**

```
import { AppsPort } from "../core/ports/apps.port.js";
import { ProvidersPort } from "../core/ports/providers.port.js";
import { FlowsPort } from "../core/ports/flows.port.js";
import { OutpostsPort } from "../core/ports/outposts.port.js";

export async function provisionForwardAuthApp(
  ports: { apps: AppsPort; providers: ProvidersPort; flows: FlowsPort; outposts: OutpostsPort },
  input: { name: string; slug?: string; domain: string; outpostId: string; mfa?: boolean; headerMap?: Record<string,string> }
) {
  const app = await ports.apps.create({ name: input.name, slug: input.slug });
  const flow = await ports.flows.ensureLoginFlow({ name: `${input.name}-login`, mfa: !!input.mfa });
  const provider = await ports.providers.createProxy({ appId: app.id, mode: "forward-auth", headerMap: input.headerMap });
  await ports.flows.bindProvider(flow.id, provider.id);
  await ports.outposts.attach(provider.id, input.outpostId);
  return { app, provider, flow };
}
```

---

# **DI container**

### **src/di/container.ts**

```
import { FetchHttpAdapter } from "../adapters/http/fetch.http.adapter.js";
import { AuthentikAppsAdapter } from "../adapters/authentik/apps.authentik.adapter.js";
// (import other authentik adapters similarly)

export function buildAuthKit(config: { authentikBaseUrl: string; authentikToken: string }) {
  const http = new FetchHttpAdapter(config.authentikBaseUrl, { Authorization: `Bearer ${config.authentikToken}` });

  const apps      = new AuthentikAppsAdapter(http);
  // const providers = new AuthentikProvidersAdapter(http);
  // const flows     = new AuthentikFlowsAdapter(http);
  // const outposts  = new AuthentikOutpostsAdapter(http);
  // const users     = new AuthentikUsersAdapter(http);
  // const orgs      = new AuthentikOrgsAdapter(http);
  // const groups    = new AuthentikGroupsAdapter(http);
  // const keys      = new AuthentikKeysAdapter(http);
  // const policies  = new AuthentikPoliciesAdapter(http);

  return {
    ports: { http, apps /*, providers, flows, outposts, users, orgs, groups, keys, policies */ }
  };
}
```

---

# **Public exports**

### **src/index.ts**

```
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

## **Notes to proceed**

- Each **adapter** file maps a small slice of Authentik’s API to a port. Keep each file tiny and focused.
- Add **providers/flows/outposts/users/orgs/groups/keys/policies** adapters next (same pattern as apps).
- The **features** layer never touches HTTP directly—only ports.
- The **usecases** are MCP-ready orchestration steps; each can later implement dryRun/plan/apply.

If you want, I can fill in the next three high-value adapters (providers, flows, outposts) and a **Radix headless <SignIn /> container** scaffold to kick off the UI kit.
