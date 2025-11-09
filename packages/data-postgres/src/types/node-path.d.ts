declare module "node:path" {
  export function dirname(path: string): string;
  export function join(...segments: string[]): string;
}
