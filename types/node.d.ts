declare namespace NodeJS {
  interface Process {
    readonly env: Record<string, string | undefined>;
    readonly argv: string[];
    exitCode?: number;
    cwd(): string;
  }
}

declare var process: NodeJS.Process;

declare interface URL {
  readonly pathname: string;
}

declare var URL: {
  new (input: string, base?: string | URL): URL;
};

declare module "node:crypto" {
  interface Hash {
    update(data: string | ArrayBufferView): Hash;
    digest(encoding: "hex" | "base64" | "latin1" | "base64url" | "binary"): string;
  }
  export function randomUUID(): string;
  export function createHash(algorithm: string): Hash;
}

declare module "node:fs/promises" {
  export function readFile(path: string, encoding: string): Promise<string>;
}

declare module "node:path" {
  export function extname(path: string): string;
}
