declare module "node:crypto" {
  export interface Hash {
    update(data: string | ArrayBufferView): Hash;
    digest(encoding: "hex"): string;
  }

  export interface KeyObject {
    readonly type: string;
    export(options: { readonly format: string }): Record<string, unknown>;
  }

  export function createHash(algorithm: string): Hash;
  export function createPrivateKey(
    key: string | Uint8Array | { readonly key: string | Uint8Array; readonly format?: string; readonly type?: string },
  ): KeyObject;
  export function createPublicKey(key: KeyObject | string | Uint8Array): KeyObject;
}

declare interface Buffer extends Uint8Array {
  toString(encoding?: string): string;
}

declare const Buffer: {
  from(data: string | Uint8Array, encoding?: string): Buffer;
};
