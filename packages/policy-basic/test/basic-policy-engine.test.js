import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createBasicPolicyEngine } from '../dist/index.js';

const baseIdentity = Object.freeze({
  userId: 'user-1',
  orgId: 'org-1',
  sessionId: 'session-1',
  groups: ['alpha', 'beta'],
  labels: { plan: 'pro', region: 'us' },
  roles: ['member'],
  entitlements: ['workspace:read'],
  scopes: ['documents:read'],
});

const baseResource = Object.freeze({
  type: 'document',
  id: 'doc-123',
  labels: { classification: 'internal' },
});

const evaluate = async (engine, overrides = {}) => {
  const input = {
    identity: baseIdentity,
    action: 'documents.read',
    resource: baseResource,
    environment: { requestIp: '127.0.0.1' },
    ...overrides,
  };
  const result = await engine.evaluate(input);
  assert.equal(result.ok, true, `Expected ok result but received ${JSON.stringify(result)}`);
  return result.value;
};

describe('BasicPolicyEngine', () => {
  test('denies when a matching deny rule exists even if allow rules match', async () => {
    const engine = createBasicPolicyEngine({
      rules: [
        {
          id: 'allow-documents',
          action: ['documents.*'],
          effect: 'allow',
        },
        {
          id: 'deny-suspended',
          action: ['documents.read'],
          effect: 'deny',
          conditions: { anyRoles: ['suspended'] },
          reason: 'policy.suspended',
        },
      ],
    });

    const decision = await evaluate(engine, {
      identity: {
        ...baseIdentity,
        roles: [...baseIdentity.roles, 'suspended'],
      },
    });

    assert.equal(decision.allow, false);
    assert.equal(decision.reason, 'policy.suspended');
  });

  test('matches resources using wildcard patterns and labels', async () => {
    const engine = createBasicPolicyEngine({
      rules: [
        {
          action: ['documents.*'],
          effect: 'allow',
          resourceType: 'doc*',
          resourceId: 'doc-*',
          resourceLabels: { classification: 'internal' },
        },
      ],
    });

    const decision = await evaluate(engine, {
      action: 'documents.update',
      resource: {
        type: 'document',
        id: 'doc-999',
        labels: { classification: 'internal', region: 'us' },
      },
    });

    assert.equal(decision.allow, true);
  });

  test('returns custom default decision when no rule matches', async () => {
    const engine = createBasicPolicyEngine({
      rules: [],
      defaultDecision: { allow: false, reason: 'policy.default.custom' },
    });

    const decision = await evaluate(engine, {
      action: 'unmatched.action',
      resource: undefined,
    });

    assert.equal(decision.allow, false);
    assert.equal(decision.reason, 'policy.default.custom');
  });

  test('clones obligations to prevent mutation leaks', async () => {
    const engine = createBasicPolicyEngine({
      rules: [
        {
          action: 'documents.read',
          effect: 'allow',
          obligations: { requireMfa: true },
        },
      ],
    });

    const firstDecision = await evaluate(engine);
    assert.equal(firstDecision.allow, true);
    assert.deepEqual(firstDecision.obligations, { requireMfa: true });

    firstDecision.obligations.requireMfa = false;

    const secondDecision = await evaluate(engine);
    assert.deepEqual(secondDecision.obligations, { requireMfa: true });
  });

  test('invokes async decision JWT factories', async () => {
    const engine = createBasicPolicyEngine({
      rules: [
        {
          action: 'documents.read',
          effect: 'allow',
          decisionJwt: async ({ identity, resource }) =>
            `${identity.userId}:${resource?.id ?? 'none'}`,
        },
      ],
    });

    const decision = await evaluate(engine, {
      resource: { ...baseResource, id: 'doc-555' },
    });

    assert.equal(decision.allow, true);
    assert.equal(decision.decisionJwt, 'user-1:doc-555');
  });
});
