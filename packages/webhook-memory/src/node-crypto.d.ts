declare module "node:crypto" {
  interface Hmac {
    update(data: string | ArrayBuffer | ArrayBufferView): Hmac;
    digest(encoding: "hex"): string;
  }

  export function createHmac(algorithm: string, key: string | ArrayBuffer | ArrayBufferView): Hmac;
}
