Awesome—here’s a tight “what’s next” plan to turn this into a shippable, high-impact SDK + MCP ops kit.

# **1) Finish the core adapters (quick wins)**

- **Fill endpoints & field mappings** you see as TODOs:
  - providers: proxy & oidc edge cases (auth flow ids, inject_headers write path).
  - flows: add MFA stages (TOTP/WebAuthn) attach → flow.
  - memberships: confirm group-membership endpoint variants on your Authentik.
  - **OpenAPI types**: generate types from /api/v3/schema/ and replace any.
- **Add error normalization**: map vendor errors → InfraError(code, message) across adapters.

# **2) Ship 3 golden workflows (MCP-ready)**

- **Provision Forward-Auth App**
  - Inputs: name, domain, outpostId, mfa?:boolean
  - Outputs: {app, provider, flow, traefikLabels}
  - Modes: dryRun/plan/apply (already scaffolded)
- **Enable Domain-Level Forward-Auth**
  - Inputs: name, outpostId, forwardAuthUrl, headers?
  - Outputs: {provider, flow, traefikSnippet}
- **Provision OIDC App**
  - Inputs: name, redirectUris[], scopes?, claims?
  - Outputs: {app, provider, flow}

# **3) Effective Identity end-to-end**

- Implement real getEffectiveIdentity merge:
  - user.labels ⊕ org.labels ⊕ union(groups.labels) ⊕ membership.labelsDelta.
- Add simple cache interface (in-memory) + invalidation on profile/membership update.

# **4) Claims & proxy headers (make apps “just work”)**

- **Claims mapping recipe**:
  - Add claimsMap.upsert() calls so OIDC includes:
    - org_id, org_slug, org_role, labels (compact), optional profile pointers.
- **Proxy header install**:
  - Write inject_headers on Proxy Provider using ProxyHeaderMap presets.

# **5) Forward-auth handler (drop-in)**

- Wire makeForwardAuthHandler() in an Elysia/Express example:
  - Verify access token (Authentik JWKS) → evaluate policy → return headers (or 401/403).
  - Include optional **decision-JWT** mint + verify for Traefik caching.

# **6) UI headless primitives (first slice)**

- React (Radix-ready):
  - <AuthProvider />, <SignedIn/>, <Gate/>, <OrgSwitcher/>, <UserProfileForm/>, <OrgProfileForm/>, <CreateApiKey/>.
- Svelte (Bits-UI-ready):
  - auth store, Gate.svelte, SignIn.svelte, Profile forms.
- Next:
  - makeNextTokenDecoder(), withAuthRoute() demo.

# **7) Example apps (smoke tests)**

- **Next.js demo**:
  - “Protect /admin” via middleware (role: 'admin' + mfa:true).
  - Render EffectiveIdentity; edit User/Org profile; create API key.
- **Traefik + Outpost**:
  - One single-app FA route & one domain-level FA. Paste labels from workflow outputs.

# **8) CI + quality bar**

- Typegen step from Authentik OpenAPI (commit the types).
- Lint, typecheck, and run a **contract test** suite that:
  - Mocks HttpPort → verifies adapter JSON → port types.
  - Runs dryRun/plan/apply for workflows.
- Add **examples** CI job (build + “can import SDK”).

# **9) Security & config**

- JWK management for decision-JWT (rotateable; from env/KMS).
- JWKS URL for access token verify (from Authentik).
- Redaction: ensure logs drop PII (emails, phone) by default.

# **10) Docs (dev-first)**

- **5 copy-paste pages**:
  1. “Protect a domain with forward-auth” (Traefik snippet + handler).
  2. “Create an OIDC app” (redirect URIs + claims).
  3. “Effective identity in UI” (React + Svelte).
  4. “Membership & roles” (invite → accept/update/remove).
  5. “API keys + exchange → access token”.

---

## **Order of work (1 week sprint)**

**Day 1–2**

- Complete adapters (providers/flows/outposts/memberships) with real endpoints.
- Add OpenAPI types; normalize errors.

**Day 3**

- Finish the 3 workflows; implement claims map + proxy header write.
- EffectiveIdentity merge + cache.

**Day 4**

- Forward-auth handler demo (Elysia); decision-JWT mint/verify.
- React/Svelte primitives slice.

**Day 5**

- Next.js example + Traefik configs; CI; docs pages.

---

## **Acceptance checklist**

- provisionForwardAuthApp() returns working Traefik labels; login redirects succeed; protected route passes with headers present.
- enableDomainLevelForwardAuth() protects multiple routers with one middleware.
- OIDC app issues tokens containing org\_\* and labels claims (as configured).
- /me/effective usage in UI shows merged profiles & labels; gates behave as expected.
- API key issued → exchanged → request passes forward-auth policy via scopes.

If you want, I can immediately fill the **MFA stages binding** (TOTP/WebAuthn add & attach in flows), and a small **Elysia server** file that exposes /forward-auth using the handler—so you can run the first end-to-end test today.
