declare module "yaml" {
  export function parse<T = any>(value: string): T;
  export function stringify(value: unknown): string;
}
