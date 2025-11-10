declare module "commander" {
  type ActionHandler = (...args: any[]) => void | Promise<void>;

  export class Command {
    constructor(name?: string);
    name(value: string): this;
    description(value: string): this;
    option(flag: string, description?: string, defaultValue?: any): this;
    option(flag: string, description: string, parser: (value: any) => any, defaultValue?: any): this;
    requiredOption(flag: string, description?: string, defaultValue?: any): this;
    command(name: string): Command;
    argument(name: string, description?: string): this;
    action(handler: ActionHandler): this;
    opts<T = any>(): T;
    parseAsync(argv: readonly string[]): Promise<void>;
  }
}
