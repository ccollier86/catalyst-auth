import type { CatalystError } from "../../types/domain-error.js";
import type { Result } from "../../types/result.js";
import type { JwtDescriptor, MintDecisionJwtInput } from "../../types/token.js";

export interface TokenServicePort {
  mintDecisionJwt(input: MintDecisionJwtInput): Promise<Result<JwtDescriptor, CatalystError>>;
}
