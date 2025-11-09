import { z } from "../vendor/zod.js";

export const labelValueSchema: z.ZodType<string | number | boolean> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
]);
export type LabelValue = z.infer<typeof labelValueSchema>;

export const labelSetSchema: z.ZodType<Record<string, LabelValue>> = z.record(labelValueSchema);
export type LabelSet = z.infer<typeof labelSetSchema>;
