import { createHmac } from "node:crypto";

import type { SignatureGenerator } from "./types.js";

const algorithm = "sha256";

export const defaultSignatureGenerator: SignatureGenerator = {
  sign(payload: string, secret: string): string {
    return createHmac(algorithm, secret).update(payload).digest("hex");
  },
};
