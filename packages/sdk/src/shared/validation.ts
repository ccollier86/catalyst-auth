import { err } from "@catalyst-auth/contracts";
import type { CatalystError, Result } from "@catalyst-auth/contracts";
import type { ZodSchema } from "../vendor/zod.js";

/**
 * Parses an input using the provided Zod schema and converts validation failures into Result errors.
 */
export const safeParse = <TInput, TOutput>(
  schema: ZodSchema<TOutput>,
  input: TInput,
  errorFactory: (issues: string) => CatalystError,
): Result<TOutput, CatalystError> => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    const messages = [
      ...flat.formErrors,
      ...Object.values(flat.fieldErrors).flat().filter((value): value is string => Boolean(value)),
    ];
    const detail = messages.length > 0 ? messages.join("; ") : parsed.error.message;
    return err(errorFactory(detail));
  }
  return { ok: true, value: parsed.data };
};
