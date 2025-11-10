/**
 * Contracts that must be implemented by host applications when wiring UI primitives.
 * Each contract intentionally mirrors the capabilities exposed by the Catalyst Auth SDK
 * but does not depend on concrete implementations. Consumers are encouraged to inject
 * memoised instances of their SDK clients in order to preserve referential stability.
 */
export interface AuthClient {
  /**
   * Trigger a sign-in flow. Returns an opaque identifier that can be used to resume the flow.
   */
  startSignIn(email: string): Promise<{ flowId: string }>;
  /**
   * Attempt to complete a sign-in flow using a verification code or magic-link token.
   */
  completeSignIn(flowId: string, code: string): Promise<{ sessionToken: string }>;
  /**
   * Sign the current user out of the active session.
   */
  signOut(): Promise<void>;
}

export interface MembershipClient {
  /** Fetch the organisations that the active profile is a member of. */
  listOrganisations(): Promise<Array<{ id: string; name: string; role: string }>>;
  /** Switch the active organisation context. */
  switchOrganisation(organisationId: string): Promise<void>;
  /** Create a new organisation. Returns its canonical identifier. */
  createOrganisation(input: { name: string }): Promise<{ id: string }>;
}

export interface KeyClient {
  /**
   * Enumerate signing keys associated with the active organisation.
   * Keys may represent API credentials, JWT signing material, or WebAuthn credentials.
   */
  listKeys(): Promise<Array<{ id: string; label: string; createdAt: string }>>;
  /** Provision a new signing key. */
  createKey(input: { label: string }): Promise<{ id: string }>;
  /** Decommission an existing key by identifier. */
  revokeKey(keyId: string): Promise<void>;
}

export interface CatalystUIClients {
  auth: AuthClient;
  membership: MembershipClient;
  keys: KeyClient;
}
