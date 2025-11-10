import type { CatalystError } from "../types/domain-error.js";
import type { Result } from "../types/result.js";

export interface AuthentikResourceSelector {
  readonly kind: string;
  readonly id?: string | undefined;
  readonly lookup?: Readonly<Record<string, string>> | undefined;
}

export interface AuthentikResourceSpec extends AuthentikResourceSelector {
  readonly properties: Readonly<Record<string, unknown>>;
  readonly labels?: Readonly<Record<string, string>> | undefined;
}

export interface AuthentikResourceState {
  readonly selector: AuthentikResourceSelector;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly revision?: string | undefined;
  readonly syncedAt?: string | undefined;
}

export interface AuthentikResourcePort {
  readonly describeResource: (
    selector: AuthentikResourceSelector,
  ) => Promise<Result<AuthentikResourceState | null, CatalystError>>;
  readonly createResource: (
    spec: AuthentikResourceSpec,
  ) => Promise<Result<AuthentikResourceState, CatalystError>>;
  readonly updateResource: (
    spec: AuthentikResourceSpec,
  ) => Promise<Result<AuthentikResourceState, CatalystError>>;
  readonly deleteResource: (
    selector: AuthentikResourceSelector,
  ) => Promise<Result<null, CatalystError>>;
}

export type AuthentikRunbookAction =
  | {
      readonly kind: "authentik.ensure";
      readonly id: string;
      readonly name: string;
      readonly description?: string | undefined;
      readonly spec: AuthentikResourceSpec;
      readonly dependsOn?: readonly string[] | undefined;
    }
  | {
      readonly kind: "authentik.delete";
      readonly id: string;
      readonly name: string;
      readonly description?: string | undefined;
      readonly selector: AuthentikResourceSelector;
      readonly dependsOn?: readonly string[] | undefined;
    };
