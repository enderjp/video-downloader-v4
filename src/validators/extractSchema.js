import { z } from "zod";

const optionsSchema = z
  .object({
    timeoutMs: z.number().int().min(3000).max(150000).optional(),
    fetchMetadata: z.boolean().optional(),
    locale: z.string().min(2).max(32).optional(),
  })
  .optional();

export const extractPayloadSchema = z.object({
  url: z
    .string()
    .url({ message: "You must supply a valid Facebook post URL." })
    .refine((value) => /facebook\.com|fb\.watch/.test(value), {
      message: "The URL must point to Facebook.",
    }),
  options: optionsSchema,
});
