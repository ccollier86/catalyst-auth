import type { EffectiveIdentity, LabelSet } from "../../types/identity.js";
import type { Result } from "../../types/result.js";
import type { CatalystError } from "../../types/domain-error.js";

export interface ResourceDescriptor {
  readonly type: string;
  readonly id?: string;
  readonly labels?: LabelSet;
  readonly attributes?: Record<string, unknown>;
}

export interface PolicyEvaluationInput {
  readonly identity: EffectiveIdentity;
  readonly action: string;
  readonly resource?: ResourceDescriptor;
  readonly environment?: Record<string, unknown>;
}

export interface PolicyDecision {
  readonly allow: boolean;
  readonly reason?: string;
  readonly obligations?: Record<string, unknown>;
  readonly decisionJwt?: string;
}

export interface PolicyEnginePort {
  evaluate(input: PolicyEvaluationInput): Promise<Result<PolicyDecision, CatalystError>>;
}
