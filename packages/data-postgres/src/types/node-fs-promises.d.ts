declare module "node:fs/promises" {
  export function readFile(
    path: string | URL,
    options: { encoding: string } | string,
  ): Promise<string>;
}
