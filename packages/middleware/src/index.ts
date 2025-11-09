export { createExpressForwardAuthMiddleware } from "./express.js";
export type {
  ExpressForwardAuthOptions,
  ExpressRequestLike,
  ExpressResponseLike,
  ExpressNextFunction,
} from "./express.js";

export { createNextForwardAuthMiddleware } from "./next.js";
export type { NextForwardAuthOptions } from "./next.js";

export { createElysiaForwardAuthPlugin } from "./elysia.js";
export type {
  ElysiaForwardAuthOptions,
  ElysiaContextLike,
  ElysiaNext,
} from "./elysia.js";
