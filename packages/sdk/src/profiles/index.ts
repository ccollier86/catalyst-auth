import { err, ok, type CatalystError, type Result, type UserProfileRecord } from "@catalyst-auth/contracts";
import { z } from "../vendor/zod.js";

import type { CatalystSdkDependencies } from "../index.js";
import { createNotFoundError, createValidationError } from "../shared/errors.js";
import { labelSetSchema } from "../shared/schemas.js";
import { safeParse } from "../shared/validation.js";

type GetUserProfileInput = {
  readonly userId: string;
};

const getUserSchema: z.ZodType<GetUserProfileInput> = z.object({
  userId: z.string().min(1),
});

/**
 * Request payload for retrieving a user profile.
 */
export type GetUserProfileRequest = z.infer<typeof getUserSchema>;

const userProfileSchema: z.ZodType<UserProfileRecord> = z.object({
  id: z.string().min(1),
  authentikId: z.string().min(1),
  email: z.string().email(),
  primaryOrgId: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
  avatarUrl: z.string().url().optional(),
  labels: labelSetSchema.default({}),
  metadata: z.record(z.unknown()).optional(),
});

type UpsertUserProfileInput = {
  readonly profile: UserProfileRecord;
};

const upsertUserSchema: z.ZodType<UpsertUserProfileInput> = z.object({
  profile: userProfileSchema,
});

/**
 * Request payload for upserting a user profile.
 */
export type UpsertUserProfileRequest = z.infer<typeof upsertUserSchema>;

/**
 * Profile-related operations exposed by the Catalyst SDK.
 */
export interface ProfilesModule {
  readonly getUserProfile: (request: GetUserProfileRequest) => Promise<Result<UserProfileRecord, CatalystError>>;
  readonly upsertUserProfile: (request: UpsertUserProfileRequest) => Promise<Result<UserProfileRecord, CatalystError>>;
}

const createGetUserProfile = (deps: CatalystSdkDependencies): ProfilesModule["getUserProfile"] => async (request) => {
  const parsed = safeParse(getUserSchema, request, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  const profile = await deps.profileStore.getUserProfile(parsed.value.userId);
  if (!profile) {
    return err(createNotFoundError("User", { userId: parsed.value.userId }));
  }
  return ok(profile);
};

const createUpsertUserProfile = (deps: CatalystSdkDependencies): ProfilesModule["upsertUserProfile"] => async (request) => {
  const parsed = safeParse(upsertUserSchema, request, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  const profile = await deps.profileStore.upsertUserProfile(parsed.value.profile);
  return ok(profile);
};

/**
 * Creates the {@link ProfilesModule} bound to the provided dependencies.
 */
export const createProfilesModule = (deps: CatalystSdkDependencies): ProfilesModule => ({
  getUserProfile: createGetUserProfile(deps),
  upsertUserProfile: createUpsertUserProfile(deps),
});
