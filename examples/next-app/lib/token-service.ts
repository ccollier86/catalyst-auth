import type { CatalystError, JwtDescriptor, MintDecisionJwtInput, Result, TokenServicePort } from "@catalyst-auth/contracts";
import { ok } from "@catalyst-auth/contracts";

export const tokenService: TokenServicePort = {
  async mintDecisionJwt(_input: MintDecisionJwtInput): Promise<Result<JwtDescriptor, CatalystError>> {
    return ok({
      token: "demo-decision-jwt",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
  },
};

export const createMemoryTokenService = (): TokenServicePort => tokenService;
