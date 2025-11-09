import {
  err,
  ok,
  type CatalystError,
  type JwtDescriptor,
  type MintDecisionJwtInput,
  type Result,
  type SessionDescriptor,
  type TokenPair,
} from "@catalyst-auth/contracts";
import { z } from "../vendor/zod.js";

import type { CatalystSdkDependencies } from "../index.js";
import { createNotFoundError, createOperationError, createValidationError } from "../shared/errors.js";
import { safeParse } from "../shared/validation.js";

const signInSchema = z.object({
  code: z.string().min(1),
  redirectUri: z.string().url(),
  clientId: z.string().min(1),
  codeVerifier: z.string().min(1).optional(),
});

/**
 * Input payload for the {@link AuthModule.signInWithCode} flow.
 */
export type SignInWithCodeRequest = z.infer<typeof signInSchema>;

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
  clientId: z.string().min(1),
});

/**
 * Input payload for the {@link AuthModule.refreshSession} flow.
 */
export type RefreshSessionRequest = z.infer<typeof refreshSchema>;

const verifySessionSchema = z.object({
  userId: z.string().min(1),
  sessionId: z.string().min(1),
});

/**
 * Input payload for the {@link AuthModule.verifySession} flow.
 */
export type VerifySessionRequest = z.infer<typeof verifySessionSchema>;

/**
 * Result payload describing a verified session.
 */
export interface VerifySessionResult {
  readonly session: SessionDescriptor;
}

const signOutSchema = verifySessionSchema.extend({
  accessToken: z.string().min(1).optional(),
});

const decisionTokenSchema = z.object({
  identity: z.object({
    userId: z.string().min(1),
    orgId: z.string().optional(),
    sessionId: z.string().optional(),
    groups: z.array(z.string()),
    labels: z.record(z.union([z.string(), z.boolean(), z.number()])),
    roles: z.array(z.string()),
    entitlements: z.array(z.string()),
    scopes: z.array(z.string()),
  }),
  action: z.string().min(1),
  resource: z
    .object({
      type: z.string().optional(),
      id: z.string().optional(),
      labels: z.record(z.union([z.string(), z.boolean(), z.number()])).optional(),
    })
    .optional(),
  environment: z.record(z.unknown()).optional(),
  audience: z.union([z.string(), z.array(z.string())]).optional(),
  ttlSeconds: z.number().int().positive().optional(),
});

/**
 * Result payload returned by {@link AuthModule.signOut}.
 */
export type SignOutRequest = z.infer<typeof signOutSchema>;

/**
 * Result payload returned by {@link AuthModule.signOut}.
 */
export interface SignOutResult {
  readonly session: SessionDescriptor;
  readonly signedOutAt: string;
}

/**
 * Authentication flows exposed by the Catalyst SDK.
 */
export interface AuthModule {
  readonly signInWithCode: (request: SignInWithCodeRequest) => Promise<Result<TokenPair, CatalystError>>;
  readonly refreshSession: (request: RefreshSessionRequest) => Promise<Result<TokenPair, CatalystError>>;
  readonly verifySession: (request: VerifySessionRequest) => Promise<Result<VerifySessionResult, CatalystError>>;
  readonly signOut: (request: SignOutRequest) => Promise<Result<SignOutResult, CatalystError>>;
  readonly issueDecisionToken: (
    request: z.infer<typeof decisionTokenSchema>,
  ) => Promise<Result<JwtDescriptor, CatalystError>>;
}

const createSignIn = (deps: CatalystSdkDependencies): AuthModule["signInWithCode"] => async (request) => {
  const parsed = safeParse(signInSchema, request, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  const result = await deps.idp.exchangeCodeForTokens(parsed.value);
  if (!result.ok) {
    return result;
  }
  return ok(result.value);
};

const createRefresh = (deps: CatalystSdkDependencies): AuthModule["refreshSession"] => async (request) => {
  const parsed = safeParse(refreshSchema, request, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  const result = await deps.idp.refreshTokens(parsed.value);
  if (!result.ok) {
    return result;
  }
  return ok(result.value);
};

const findSession = async (
  deps: CatalystSdkDependencies,
  request: VerifySessionRequest,
): Promise<Result<SessionDescriptor, CatalystError>> => {
  const sessionsResult = await deps.idp.listActiveSessions(request.userId);
  if (!sessionsResult.ok) {
    return sessionsResult;
  }
  const session = sessionsResult.value.find((candidate) => candidate.id === request.sessionId);
  if (!session) {
    return err(createNotFoundError("Session", { userId: request.userId, sessionId: request.sessionId }));
  }
  return ok(session);
};

const createVerify = (deps: CatalystSdkDependencies): AuthModule["verifySession"] => async (request) => {
  const parsed = safeParse(verifySessionSchema, request, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  const sessionResult = await findSession(deps, parsed.value);
  if (!sessionResult.ok) {
    return sessionResult;
  }
  return ok({ session: sessionResult.value });
};

const createSignOut = (deps: CatalystSdkDependencies): AuthModule["signOut"] => async (request) => {
  const parsed = safeParse(signOutSchema, request, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  const sessionResult = await findSession(deps, parsed.value);
  if (!sessionResult.ok) {
    return sessionResult;
  }
  if (parsed.value.accessToken) {
    const verifyResult = await deps.idp.validateAccessToken(parsed.value.accessToken);
    if (!verifyResult.ok || !verifyResult.value.active) {
      const fallbackError = createOperationError("auth.sign_out_failed", "Access token validation failed.", {
        userId: parsed.value.userId,
        sessionId: parsed.value.sessionId,
      });
      return err(fallbackError);
    }
  }
  const signedOutAt = new Date().toISOString();
  return ok({ session: sessionResult.value, signedOutAt });
};

const createIssueDecisionToken = (
  deps: CatalystSdkDependencies,
): AuthModule["issueDecisionToken"] => async (request) => {
  const parsed = safeParse(decisionTokenSchema, request, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  return deps.tokenService.mintDecisionJwt(parsed.value as MintDecisionJwtInput);
};

/**
 * Creates the {@link AuthModule} bound to the provided dependencies.
 */
export const createAuthModule = (deps: CatalystSdkDependencies): AuthModule => ({
  signInWithCode: createSignIn(deps),
  refreshSession: createRefresh(deps),
  verifySession: createVerify(deps),
  signOut: createSignOut(deps),
  issueDecisionToken: createIssueDecisionToken(deps),
});
