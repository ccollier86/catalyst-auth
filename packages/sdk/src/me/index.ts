import { type CatalystError, type EffectiveIdentity, type Result } from "@catalyst-auth/contracts";
import { z } from "../vendor/zod.js";

import type { CatalystSdkDependencies } from "../index.js";
import { createValidationError } from "../shared/errors.js";
import { safeParse } from "../shared/validation.js";

type EffectiveIdentityInput = {
  readonly userId: string;
  readonly orgId?: string | undefined;
  readonly membershipId?: string | undefined;
  readonly includeGroups?: boolean | undefined;
};

const effectiveIdentitySchema: z.ZodType<EffectiveIdentityInput> = z.object({
  userId: z.string().min(1),
  orgId: z.string().min(1).optional(),
  membershipId: z.string().min(1).optional(),
  includeGroups: z.boolean().optional(),
});

/**
 * Request payload for retrieving an effective identity.
 */
export type EffectiveIdentityRequest = z.infer<typeof effectiveIdentitySchema>;

/**
 * Me module exposes helper queries for the currently authenticated principal.
 */
export interface MeModule {
  readonly getEffectiveIdentity: (
    request: EffectiveIdentityRequest,
  ) => Promise<Result<EffectiveIdentity, CatalystError>>;
}

const createGetEffectiveIdentity = (deps: CatalystSdkDependencies): MeModule["getEffectiveIdentity"] => async (request) => {
  const parsed = safeParse(effectiveIdentitySchema, request, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  const identity = await deps.profileStore.computeEffectiveIdentity(parsed.value);
  return { ok: true, value: identity };
};

/**
 * Creates the {@link MeModule} bound to the provided dependencies.
 */
export const createMeModule = (deps: CatalystSdkDependencies): MeModule => ({
  getEffectiveIdentity: createGetEffectiveIdentity(deps),
});
