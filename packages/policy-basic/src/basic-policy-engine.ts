import type {
  CatalystError,
  LabelSet,
  PolicyDecision,
  PolicyEnginePort,
  PolicyEvaluationInput,
  Result,
} from "@catalyst-auth/contracts";
import { ok } from "@catalyst-auth/contracts";

import type {
  BasicPolicyConditions,
  BasicPolicyEffect,
  BasicPolicyEngineOptions,
  BasicPolicyRule,
  DecisionJwtFactory,
} from "./types.js";

const structuredCloneFn: (<T>(value: T) => T) | undefined =
  (globalThis as unknown as { structuredClone?: <T>(value: T) => T }).structuredClone;

const clone = <T>(value: T): T => {
  if (structuredCloneFn) {
    return structuredCloneFn(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
};

const cloneDecision = (decision: PolicyDecision): PolicyDecision => ({
  allow: decision.allow,
  reason: decision.reason,
  obligations: decision.obligations ? clone(decision.obligations) : undefined,
  decisionJwt: decision.decisionJwt,
});

const dedupeStrings = (values: ReadonlyArray<string>): ReadonlyArray<string> => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
};

const normalizeStringArray = (
  values?: ReadonlyArray<string>,
): ReadonlyArray<string> | undefined => {
  if (!values || values.length === 0) {
    return undefined;
  }
  const normalized: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    normalized.push(trimmed);
  }
  if (normalized.length === 0) {
    return undefined;
  }
  return dedupeStrings(normalized);
};

const escapeForRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface StringMatcher {
  readonly pattern: string;
  readonly test: (candidate: string) => boolean;
}

const createMatcher = (pattern: string): StringMatcher => {
  if (pattern === "*") {
    return { pattern, test: () => true };
  }
  const normalized = pattern.trim();
  if (!normalized) {
    return { pattern: "", test: () => false };
  }
  const expression = new RegExp(
    `^${escapeForRegExp(normalized).replace(/\\\*/g, ".*")}$`,
  );
  return { pattern: normalized, test: (candidate: string) => expression.test(candidate) };
};

const matchesAction = (
  matchers: ReadonlyArray<StringMatcher>,
  action: string,
): boolean => matchers.some((matcher) => matcher.test(action));

const labelsContainAll = (actual: LabelSet | undefined, required?: LabelSet): boolean => {
  if (!required) {
    return true;
  }
  if (!actual) {
    return false;
  }
  for (const [key, value] of Object.entries(required)) {
    if (!(key in actual)) {
      return false;
    }
    if (actual[key] !== value) {
      return false;
    }
  }
  return true;
};

const labelsContainNone = (actual: LabelSet | undefined, forbidden?: LabelSet): boolean => {
  if (!forbidden) {
    return true;
  }
  if (!actual) {
    return true;
  }
  for (const [key, value] of Object.entries(forbidden)) {
    if (key in actual && actual[key] === value) {
      return false;
    }
  }
  return true;
};

const matchesRecord = (
  expected: Record<string, unknown> | undefined,
  actual: Record<string, unknown> | undefined,
): boolean => {
  if (!expected || Object.keys(expected).length === 0) {
    return true;
  }
  if (!actual) {
    return false;
  }
  for (const [key, value] of Object.entries(expected)) {
    if (!(key in actual)) {
      return false;
    }
    if (actual[key] !== value) {
      return false;
    }
  }
  return true;
};

const includesAny = (
  haystack: ReadonlySet<string>,
  needles?: ReadonlyArray<string>,
): boolean => {
  if (!needles || needles.length === 0) {
    return true;
  }
  for (const needle of needles) {
    if (haystack.has(needle)) {
      return true;
    }
  }
  return false;
};

const includesAll = (
  haystack: ReadonlySet<string>,
  needles?: ReadonlyArray<string>,
): boolean => {
  if (!needles || needles.length === 0) {
    return true;
  }
  for (const needle of needles) {
    if (!haystack.has(needle)) {
      return false;
    }
  }
  return true;
};

type NormalizedDecisionJwtFactory = (
  input: PolicyEvaluationInput,
) => Promise<string | undefined>;

interface NormalizedConditions {
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

const hasConditions = (conditions: NormalizedConditions): boolean =>
  Boolean(
    conditions.anyRoles?.length ||
      conditions.allRoles?.length ||
      conditions.anyGroups?.length ||
      conditions.allGroups?.length ||
      conditions.anyScopes?.length ||
      conditions.allScopes?.length ||
      conditions.anyEntitlements?.length ||
      conditions.allEntitlements?.length ||
      (conditions.requireLabels && Object.keys(conditions.requireLabels).length > 0) ||
      (conditions.forbidLabels && Object.keys(conditions.forbidLabels).length > 0) ||
      (conditions.environment && Object.keys(conditions.environment).length > 0),
  );

const normalizeConditions = (
  input?: BasicPolicyConditions,
): NormalizedConditions | undefined => {
  if (!input) {
    return undefined;
  }
  const normalized: NormalizedConditions = {
    anyRoles: normalizeStringArray(input.anyRoles),
    allRoles: normalizeStringArray(input.allRoles),
    anyGroups: normalizeStringArray(input.anyGroups),
    allGroups: normalizeStringArray(input.allGroups),
    anyScopes: normalizeStringArray(input.anyScopes),
    allScopes: normalizeStringArray(input.allScopes),
    anyEntitlements: normalizeStringArray(input.anyEntitlements),
    allEntitlements: normalizeStringArray(input.allEntitlements),
    requireLabels: input.requireLabels ? clone(input.requireLabels) : undefined,
    forbidLabels: input.forbidLabels ? clone(input.forbidLabels) : undefined,
    environment: input.environment ? clone(input.environment) : undefined,
  };
  return hasConditions(normalized) ? normalized : undefined;
};

const toDecisionJwtFactory = (
  input?: string | DecisionJwtFactory,
): NormalizedDecisionJwtFactory | undefined => {
  if (!input) {
    return undefined;
  }
  if (typeof input === "function") {
    return async (evaluationInput: PolicyEvaluationInput) => input(evaluationInput);
  }
  const value = input;
  return async () => value;
};

interface NormalizedRule {
  readonly id?: string;
  readonly effect: BasicPolicyEffect;
  readonly actionMatchers: ReadonlyArray<StringMatcher>;
  readonly resourceTypeMatcher?: StringMatcher;
  readonly resourceIdMatcher?: StringMatcher;
  readonly resourceLabels?: LabelSet;
  readonly conditions?: NormalizedConditions;
  readonly reason?: string;
  readonly obligations?: Record<string, unknown>;
  readonly decisionJwtFactory?: NormalizedDecisionJwtFactory;
}

const normalizeRule = (rule: BasicPolicyRule): NormalizedRule => {
  const actionList = Array.isArray(rule.action)
    ? rule.action
    : [rule.action];
  const filteredActions = actionList
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const uniqueActions = dedupeStrings(filteredActions);
  if (uniqueActions.length === 0) {
    throw new Error(`Policy rule${rule.id ? ` ${rule.id}` : ""} must define at least one action pattern.`);
  }

  const resourceLabels = rule.resourceLabels ? clone(rule.resourceLabels) : undefined;
  const obligations = rule.obligations ? clone(rule.obligations) : undefined;
  const reason = rule.reason ?? (rule.id ? `policy.rule.${rule.id}.${rule.effect}` : undefined);

  return {
    id: rule.id,
    effect: rule.effect,
    actionMatchers: uniqueActions.map(createMatcher),
    resourceTypeMatcher: rule.resourceType ? createMatcher(rule.resourceType) : undefined,
    resourceIdMatcher: rule.resourceId ? createMatcher(rule.resourceId) : undefined,
    resourceLabels,
    conditions: normalizeConditions(rule.conditions),
    reason,
    obligations,
    decisionJwtFactory: toDecisionJwtFactory(rule.decisionJwt),
  };
};

const matchesResource = (
  rule: NormalizedRule,
  resource: PolicyEvaluationInput["resource"],
): boolean => {
  if (!rule.resourceTypeMatcher && !rule.resourceIdMatcher && !rule.resourceLabels) {
    return true;
  }
  if (!resource) {
    return false;
  }
  if (
    rule.resourceTypeMatcher &&
    (!resource.type || !rule.resourceTypeMatcher.test(resource.type))
  ) {
    return false;
  }
  if (
    rule.resourceIdMatcher &&
    (!resource.id || !rule.resourceIdMatcher.test(resource.id))
  ) {
    return false;
  }
  if (!labelsContainAll(resource.labels, rule.resourceLabels)) {
    return false;
  }
  return true;
};

const matchesConditions = (
  conditions: NormalizedConditions | undefined,
  input: PolicyEvaluationInput,
): boolean => {
  if (!conditions) {
    return true;
  }

  const identity = input.identity;
  const roleSet = new Set(identity.roles);
  const groupSet = new Set(identity.groups);
  const scopeSet = new Set(identity.scopes);
  const entitlementSet = new Set(identity.entitlements);

  if (!includesAny(roleSet, conditions.anyRoles)) {
    return false;
  }
  if (!includesAll(roleSet, conditions.allRoles)) {
    return false;
  }
  if (!includesAny(groupSet, conditions.anyGroups)) {
    return false;
  }
  if (!includesAll(groupSet, conditions.allGroups)) {
    return false;
  }
  if (!includesAny(scopeSet, conditions.anyScopes)) {
    return false;
  }
  if (!includesAll(scopeSet, conditions.allScopes)) {
    return false;
  }
  if (!includesAny(entitlementSet, conditions.anyEntitlements)) {
    return false;
  }
  if (!includesAll(entitlementSet, conditions.allEntitlements)) {
    return false;
  }
  if (!labelsContainAll(identity.labels, conditions.requireLabels)) {
    return false;
  }
  if (!labelsContainNone(identity.labels, conditions.forbidLabels)) {
    return false;
  }
  if (!matchesRecord(conditions.environment, input.environment)) {
    return false;
  }

  return true;
};

const DEFAULT_DENY_DECISION: PolicyDecision = {
  allow: false,
  reason: "policy.default.deny",
};

export class BasicPolicyEngine implements PolicyEnginePort {
  private readonly rules: ReadonlyArray<NormalizedRule>;
  private readonly defaultDecision: PolicyDecision;

  constructor(options: BasicPolicyEngineOptions) {
    this.rules = options.rules.map(normalizeRule);
    this.defaultDecision = options.defaultDecision
      ? cloneDecision(options.defaultDecision)
      : { ...DEFAULT_DENY_DECISION };
  }

  async evaluate(
    input: PolicyEvaluationInput,
  ): Promise<Result<PolicyDecision, CatalystError>> {
    let matchedAllowRule: NormalizedRule | undefined;

    for (const rule of this.rules) {
      if (!matchesAction(rule.actionMatchers, input.action)) {
        continue;
      }
      if (!matchesResource(rule, input.resource)) {
        continue;
      }
      if (!matchesConditions(rule.conditions, input)) {
        continue;
      }

      if (rule.effect === "deny") {
        const decision = await this.buildDecision(rule, input);
        return ok(decision);
      }

      if (!matchedAllowRule) {
        matchedAllowRule = rule;
      }
    }

    if (matchedAllowRule) {
      const decision = await this.buildDecision(matchedAllowRule, input);
      return ok(decision);
    }

    return ok(cloneDecision(this.defaultDecision));
  }

  private async buildDecision(
    rule: NormalizedRule,
    input: PolicyEvaluationInput,
  ): Promise<PolicyDecision> {
    const decisionJwt = rule.decisionJwtFactory
      ? await rule.decisionJwtFactory(input)
      : undefined;
    return {
      allow: rule.effect === "allow",
      reason: rule.reason,
      obligations: rule.obligations ? clone(rule.obligations) : undefined,
      decisionJwt,
    };
  }
}

export const createBasicPolicyEngine = (
  options: BasicPolicyEngineOptions,
): PolicyEnginePort => new BasicPolicyEngine(options);
