export { ForwardAuthService, defaultHashApiKey } from "./forward-auth-service.js";
export { createForwardAuthFetchHandler } from "./forward-auth-fetch-handler.js";
export type {
  ForwardAuthRequest,
  ForwardAuthResponse,
  ForwardAuthConfig,
  ForwardAuthLogger,
  DecisionCacheEntry,
  ForwardAuthFetchHandlerOptions,
  ForwardAuthHandlerContext,
} from "./types.js";

export { buildTraefikForwardAuthConfig } from "./traefik-config.js";
export {
  createDecisionCacheWarmer,
  createDecisionJwksResponse,
  warmDecisionsWithService,
} from "./decision-distribution.js";
export type {
  TraefikForwardAuthOptions,
  TraefikForwardAuthConfig,
  TraefikDecisionRouteOptions,
} from "./traefik-config.js";
export type {
  DecisionCacheWarmerOptions,
  DecisionCacheWarmResult,
  DecisionWarmRequest,
  DecisionJwkInput,
  DecisionJwksResponseOptions,
  ForwardAuthLike,
} from "./decision-distribution.js";
