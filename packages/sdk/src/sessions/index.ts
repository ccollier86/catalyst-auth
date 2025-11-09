import { err, ok, type CatalystError, type Result, type SessionRecord } from "@catalyst-auth/contracts";
import { z } from "../vendor/zod.js";

import type { CatalystSdkDependencies } from "../index.js";
import { createNotFoundError, createValidationError } from "../shared/errors.js";
import { safeParse } from "../shared/validation.js";

const sessionRecordSchema: z.ZodType<SessionRecord> = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  createdAt: z.string().min(1),
  lastSeenAt: z.string().min(1),
  factorsVerified: z.array(z.string().min(1)).default([]),
  metadata: z.record(z.unknown()).optional(),
});

const getSessionSchema = z.object({
  sessionId: z.string().min(1),
});

const listSessionsSchema = z.object({
  userId: z.string().min(1),
});

const createSessionSchema = z.object({
  session: sessionRecordSchema,
});

const touchSessionSchema = z.object({
  sessionId: z.string().min(1),
  update: z.object({
    lastSeenAt: z.string().min(1),
    factorsVerified: z.array(z.string().min(1)).optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
});

const deleteSessionSchema = z.object({
  sessionId: z.string().min(1),
});

export interface SessionsModule {
  readonly getSession: (
    input: z.infer<typeof getSessionSchema>,
  ) => Promise<Result<SessionRecord, CatalystError>>;
  readonly listSessions: (
    input: z.infer<typeof listSessionsSchema>,
  ) => Promise<Result<ReadonlyArray<SessionRecord>, CatalystError>>;
  readonly createSession: (
    input: z.infer<typeof createSessionSchema>,
  ) => Promise<Result<SessionRecord, CatalystError>>;
  readonly touchSession: (
    input: z.infer<typeof touchSessionSchema>,
  ) => Promise<Result<SessionRecord, CatalystError>>;
  readonly deleteSession: (
    input: z.infer<typeof deleteSessionSchema>,
  ) => Promise<Result<null, CatalystError>>;
}

const createGetSession = (
  deps: CatalystSdkDependencies,
): SessionsModule["getSession"] => async (input) => {
  const parsed = safeParse(getSessionSchema, input, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  const session = await deps.sessionStore.getSession(parsed.value.sessionId);
  if (!session) {
    return err(createNotFoundError("Session", { sessionId: parsed.value.sessionId }));
  }
  return ok(session);
};

const createListSessions = (
  deps: CatalystSdkDependencies,
): SessionsModule["listSessions"] => async (input) => {
  const parsed = safeParse(listSessionsSchema, input, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  const sessions = await deps.sessionStore.listSessionsByUser(parsed.value.userId);
  return ok(sessions);
};

const createCreateSession = (
  deps: CatalystSdkDependencies,
): SessionsModule["createSession"] => async (input) => {
  const parsed = safeParse(createSessionSchema, input, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  const session = await deps.sessionStore.createSession(parsed.value.session);
  return ok(session);
};

const createTouchSession = (
  deps: CatalystSdkDependencies,
): SessionsModule["touchSession"] => async (input) => {
  const parsed = safeParse(touchSessionSchema, input, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  const session = await deps.sessionStore.touchSession(parsed.value.sessionId, parsed.value.update);
  return ok(session);
};

const createDeleteSession = (
  deps: CatalystSdkDependencies,
): SessionsModule["deleteSession"] => async (input) => {
  const parsed = safeParse(deleteSessionSchema, input, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  await deps.sessionStore.deleteSession(parsed.value.sessionId);
  return ok(null);
};

export const createSessionsModule = (deps: CatalystSdkDependencies): SessionsModule => ({
  getSession: createGetSession(deps),
  listSessions: createListSessions(deps),
  createSession: createCreateSession(deps),
  touchSession: createTouchSession(deps),
  deleteSession: createDeleteSession(deps),
});
