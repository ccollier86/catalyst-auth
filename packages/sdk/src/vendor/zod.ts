export type ParseSuccess<T> = { success: true; data: T };
export type ParseFailure = { success: false; error: ZodError };
export type ParseResult<T> = ParseSuccess<T> | ParseFailure;

export interface ZodErrorIssue {
  readonly path: ReadonlyArray<string>;
  readonly message: string;
}

export class ZodError extends Error {
  readonly issues: ReadonlyArray<ZodErrorIssue>;

  constructor(issues: ReadonlyArray<ZodErrorIssue>) {
    super("Validation failed");
    this.issues = issues;
  }

  flatten(): { formErrors: string[]; fieldErrors: Record<string, string[]> } {
    const formErrors: string[] = [];
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of this.issues) {
      if (issue.path.length === 0) {
        formErrors.push(issue.message);
        continue;
      }
      const key = issue.path.join(".");
      if (!fieldErrors[key]) {
        fieldErrors[key] = [];
      }
      fieldErrors[key]?.push(issue.message);
    }
    return { formErrors, fieldErrors };
  }
}

export abstract class BaseSchema<T> {
  abstract safeParse(input: unknown, path?: ReadonlyArray<string>): ParseResult<T>;

  optional(): BaseSchema<T | undefined> {
    return new OptionalSchema(this);
  }

  default(value: T): BaseSchema<T> {
    return new DefaultSchema(this, value);
  }
}

class OptionalSchema<T> extends BaseSchema<T | undefined> {
  constructor(private readonly inner: BaseSchema<T>) {
    super();
  }

  safeParse(input: unknown, path: ReadonlyArray<string> = []): ParseResult<T | undefined> {
    if (input === undefined || input === null) {
      return { success: true, data: undefined };
    }
    return this.inner.safeParse(input, path);
  }
}

class DefaultSchema<T> extends BaseSchema<T> {
  constructor(private readonly inner: BaseSchema<T>, private readonly fallback: T) {
    super();
  }

  safeParse(input: unknown, path: ReadonlyArray<string> = []): ParseResult<T> {
    if (input === undefined || input === null) {
      return { success: true, data: this.fallback };
    }
    return this.inner.safeParse(input, path);
  }
}

class StringSchema extends BaseSchema<string> {
  private readonly checks: Array<(value: string) => string | null> = [];

  safeParse(input: unknown, path: ReadonlyArray<string> = []): ParseResult<string> {
    if (typeof input !== "string") {
      return {
        success: false,
        error: new ZodError([{ path, message: "Expected string" }]),
      };
    }
    for (const check of this.checks) {
      const failure = check(input);
      if (failure) {
        return { success: false, error: new ZodError([{ path, message: failure }]) };
      }
    }
    return { success: true, data: input };
  }

  min(length: number): StringSchema {
    this.checks.push((value) => (value.length < length ? `Expected at least ${length} characters` : null));
    return this;
  }

  url(): StringSchema {
    this.checks.push((value) => {
      try {
        new URL(value);
        return null;
      } catch {
        return "Expected valid URL";
      }
    });
    return this;
  }

  email(): StringSchema {
    this.checks.push((value) => (/^[^@]+@[^@]+\.[^@]+$/.test(value) ? null : "Expected email"));
    return this;
  }
}

class NumberSchema extends BaseSchema<number> {
  private readonly checks: Array<(value: number) => string | null> = [];

  safeParse(input: unknown, path: ReadonlyArray<string> = []): ParseResult<number> {
    if (typeof input !== "number" || Number.isNaN(input)) {
      return { success: false, error: new ZodError([{ path, message: "Expected number" }]) };
    }
    for (const check of this.checks) {
      const failure = check(input);
      if (failure) {
        return { success: false, error: new ZodError([{ path, message: failure }]) };
      }
    }
    return { success: true, data: input };
  }

  int(): NumberSchema {
    this.checks.push((value) => (Number.isInteger(value) ? null : "Expected integer"));
    return this;
  }

  positive(): NumberSchema {
    this.checks.push((value) => (value > 0 ? null : "Expected positive number"));
    return this;
  }

  nonnegative(): NumberSchema {
    this.checks.push((value) => (value >= 0 ? null : "Expected non-negative number"));
    return this;
  }
}

class BooleanSchema extends BaseSchema<boolean> {
  safeParse(input: unknown, path: ReadonlyArray<string> = []): ParseResult<boolean> {
    if (typeof input !== "boolean") {
      return { success: false, error: new ZodError([{ path, message: "Expected boolean" }]) };
    }
    return { success: true, data: input };
  }
}

class ArraySchema<T> extends BaseSchema<ReadonlyArray<T>> {
  private minLength?: number;

  constructor(private readonly inner: BaseSchema<T>) {
    super();
  }

  safeParse(input: unknown, path: ReadonlyArray<string> = []): ParseResult<ReadonlyArray<T>> {
    if (!Array.isArray(input)) {
      return { success: false, error: new ZodError([{ path, message: "Expected array" }]) };
    }
    if (this.minLength !== undefined && input.length < this.minLength) {
      return {
        success: false,
        error: new ZodError([{ path, message: `Expected at least ${this.minLength} items` }]),
      };
    }
    const values: T[] = [];
    for (const [index, item] of input.entries()) {
      const result = this.inner.safeParse(item, [...path, String(index)]);
      if (!result.success) {
        return result;
      }
      values.push(result.data);
    }
    return { success: true, data: values };
  }

  min(length: number): ArraySchema<T> {
    this.minLength = length;
    return this;
  }
}

class EnumSchema<T extends string> extends BaseSchema<T> {
  constructor(private readonly values: ReadonlyArray<T>) {
    super();
  }

  safeParse(input: unknown, path: ReadonlyArray<string> = []): ParseResult<T> {
    if (typeof input !== "string" || !this.values.includes(input as T)) {
      return {
        success: false,
        error: new ZodError([{ path, message: `Expected one of: ${this.values.join(", ")}` }]),
      };
    }
    return { success: true, data: input as T };
  }
}

type AnySchema = BaseSchema<unknown>;
type SchemaValue<TSchema extends AnySchema> = TSchema extends BaseSchema<infer TValue> ? TValue : never;
type InferUnion<TSchemas extends ReadonlyArray<AnySchema>> = TSchemas[number] extends AnySchema
  ? SchemaValue<TSchemas[number]>
  : never;

class UnionSchema<TSchemas extends ReadonlyArray<AnySchema>> extends BaseSchema<InferUnion<TSchemas>> {
  constructor(private readonly options: TSchemas) {
    super();
  }

  safeParse(input: unknown, path: ReadonlyArray<string> = []): ParseResult<InferUnion<TSchemas>> {
    const issues: ZodErrorIssue[] = [];
    for (const option of this.options) {
      const result = option.safeParse(input, path);
      if (result.success) {
        return result as ParseSuccess<InferUnion<TSchemas>>;
      }
      issues.push(...result.error.issues);
    }
    return { success: false, error: new ZodError(issues.length ? issues : [{ path, message: "No union matched" }]) };
  }
}

class RecordSchema<T> extends BaseSchema<Record<string, T>> {
  constructor(private readonly valueSchema: BaseSchema<T>) {
    super();
  }

  safeParse(input: unknown, path: ReadonlyArray<string> = []): ParseResult<Record<string, T>> {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return { success: false, error: new ZodError([{ path, message: "Expected object" }]) };
    }
    const result: Record<string, T> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      const parsed = this.valueSchema.safeParse(value, [...path, key]);
      if (!parsed.success) {
        return parsed;
      }
      result[key] = parsed.data;
    }
    return { success: true, data: result };
  }
}

class UnknownSchema extends BaseSchema<unknown> {
  safeParse(input: unknown): ParseResult<unknown> {
    return { success: true, data: input };
  }
}

class ObjectSchema<T extends Record<string, unknown>> extends BaseSchema<T> {
  constructor(private readonly shape: { [K in keyof T]: BaseSchema<T[K]> }) {
    super();
  }

  safeParse(input: unknown, path: ReadonlyArray<string> = []): ParseResult<T> {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return { success: false, error: new ZodError([{ path, message: "Expected object" }]) };
    }
    const output: Record<string, unknown> = {};
    const inputRecord = input as Record<PropertyKey, unknown>;
    for (const key of Object.keys(this.shape) as Array<keyof T>) {
      const schema = this.shape[key];
      const value = inputRecord[key as PropertyKey];
      const parsed = schema.safeParse(value, [...path, String(key)]);
      if (!parsed.success) {
        return parsed as ParseFailure;
      }
      if (parsed.data !== undefined) {
        output[key as string] = parsed.data;
      }
    }
    return { success: true, data: output as T };
  }

  extend<TAdditional extends Record<string, unknown>>(
    addition: { [K in keyof TAdditional]: BaseSchema<TAdditional[K]> },
  ): ObjectSchema<T & TAdditional> {
    return new ObjectSchema({
      ...(this.shape as Record<string, BaseSchema<unknown>>),
      ...(addition as Record<string, BaseSchema<unknown>>),
    }) as ObjectSchema<T & TAdditional>;
  }
}

export interface ZNamespace {
  string: () => StringSchema;
  number: () => NumberSchema;
  boolean: () => BooleanSchema;
  array: <T>(schema: BaseSchema<T>) => ArraySchema<T>;
  object: <T extends Record<string, unknown>>(shape: { [K in keyof T]: BaseSchema<T[K]> }) => ObjectSchema<T>;
  enum: <T extends string>(values: readonly T[]) => EnumSchema<T>;
  union: <TSchemas extends ReadonlyArray<AnySchema>>(schemas: TSchemas) => UnionSchema<TSchemas>;
  record: <T>(schema?: BaseSchema<T>) => RecordSchema<T>;
  unknown: () => UnknownSchema;
}

export const z: ZNamespace & { ZodType: typeof BaseSchema } = {
  string: () => new StringSchema(),
  number: () => new NumberSchema(),
  boolean: () => new BooleanSchema(),
  array: <T>(schema: BaseSchema<T>) => new ArraySchema(schema),
  object: <T extends Record<string, unknown>>(shape: { [K in keyof T]: BaseSchema<T[K]> }) => new ObjectSchema(shape),
  enum: <T extends string>(values: readonly T[]) => new EnumSchema(values as T[]),
  union: <TSchemas extends ReadonlyArray<AnySchema>>(schemas: TSchemas) => new UnionSchema(schemas),
  record: <T>(schema: BaseSchema<T> = new UnknownSchema() as BaseSchema<T>) => new RecordSchema(schema),
  unknown: () => new UnknownSchema(),
  ZodType: BaseSchema,
};

export type ZodType<T> = BaseSchema<T>;
export type ZodSchema<T> = BaseSchema<T>;

type InferOutput<TSchema extends BaseSchema<unknown>> = TSchema extends BaseSchema<infer T> ? T : never;

export namespace z {
  export type infer<TSchema extends BaseSchema<unknown>> = InferOutput<TSchema>;
  export type ZodType<T> = BaseSchema<T>;
  export type ZodSchema<T> = BaseSchema<T>;
}
