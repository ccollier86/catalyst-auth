import type { CatalystError } from "../../types/domain-error.js";
import type { Result } from "../../types/result.js";
import type {
  JwtDescriptor,
  MintAccessTokenInput,
  MintDecisionJwtInput,
  MintRefreshTokenInput,
  TokenPair,
} from "../../types/token.js";

export interface TokenServicePort {
  mintDecisionJwt(input: MintDecisionJwtInput): Promise<Result<JwtDescriptor, CatalystError>>;
  mintAccessToken(input: MintAccessTokenInput): Promise<Result<JwtDescriptor, CatalystError>>;
  mintRefreshToken(input: MintRefreshTokenInput): Promise<Result<JwtDescriptor, CatalystError>>;
  mintTokenPair(
    accessInput: MintAccessTokenInput,
    refreshInput: MintRefreshTokenInput,
  ): Promise<Result<TokenPair, CatalystError>>;
}
