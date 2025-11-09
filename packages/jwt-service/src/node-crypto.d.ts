declare module "node:crypto" {
  export interface KeyObject {
    readonly type: string;
  }

  export interface Signer {
    update(data: string | Uint8Array): Signer;
    end(): void;
    sign(key: KeyObject | string | Uint8Array): Uint8Array;
  }

  export function createPrivateKey(
    key: string | Uint8Array | { readonly key: string | Uint8Array; readonly format?: string; readonly type?: string },
  ): KeyObject;
  export function createSign(algorithm: string): Signer;
  export function randomUUID(): string;
  export function sign(
    algorithm: string | null,
    data: Uint8Array,
    key: KeyObject | string | Uint8Array,
  ): Uint8Array;
}

declare interface Buffer extends Uint8Array {
  toString(encoding?: string): string;
}

declare const Buffer: {
  from(data: string | Uint8Array, encoding?: string): Buffer;
};
