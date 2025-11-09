import type { LabelSet, PolicyDecision, PolicyEvaluationInput } from "@catalyst-auth/contracts";

export type BasicPolicyEffect = "allow" | "deny";

export interface BasicPolicyConditions {
  readonly anyRoles?: ReadonlyArray<string>;
  readonly allRoles?: ReadonlyArray<string>;
  readonly anyGroups?: ReadonlyArray<string>;
  readonly allGroups?: ReadonlyArray<string>;
  readonly anyScopes?: ReadonlyArray<string>;
  readonly allScopes?: ReadonlyArray<string>;
  readonly anyEntitlements?: ReadonlyArray<string>;
  readonly allEntitlements?: ReadonlyArray<string>;
  readonly requireLabels?: LabelSet;
  readonly forbidLabels?: LabelSet;
  readonly environment?: Record<string, unknown>;
}

export type DecisionJwtFactory = (
  input: PolicyEvaluationInput,
) => string | undefined | Promise<string | undefined>;

export interface BasicPolicyRule {
  readonly id?: string;
  readonly action: string | ReadonlyArray<string>;
  readonly effect: BasicPolicyEffect;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly resourceLabels?: LabelSet;
  readonly conditions?: BasicPolicyConditions;
  readonly reason?: string;
  readonly obligations?: Record<string, unknown>;
  readonly decisionJwt?: string | DecisionJwtFactory;
}

export interface BasicPolicyEngineOptions {
  readonly rules: ReadonlyArray<BasicPolicyRule>;
  readonly defaultDecision?: PolicyDecision;
}
