import { z } from "zod";
import { QuoteSchema, AddressSchema, Quote } from "@intentguard/core";

/** Quotes arrive as JSON, so the bigint field is accepted as a string or integer. */
const QuoteInputSchema = QuoteSchema.extend({
  expectedOutputTokens: z
    .union([z.string().regex(/^\d+$/), z.number().int().nonnegative()])
    .transform((v) => BigInt(v)),
  solverName: z.string().max(200),
  tokenSymbol: z.string().max(64),
  protocolSlug: z.string().regex(/^[a-z0-9-]{1,64}$/i, "protocolSlug must be alphanumeric/hyphen"),
  protocolDescription: z.string().max(2000),
  annotations: z.string().max(2000),
});

export const DecideBodySchema = z
  .object({
    mandate: z.string().trim().min(1).max(2000).optional(),
    notionalUsd: z.number().positive().max(1_000_000_000).optional(),
    quotes: z.array(QuoteInputSchema).min(1).max(10).optional(),
  })
  .strict();

export type DecideBody = { mandate?: string; notionalUsd?: number; quotes?: Quote[] };

export const SabotageBodySchema = z
  .object({
    routeId: z.string().max(64).optional(),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  })
  .strict();

export const AddressParamSchema = AddressSchema;

/** Flatten a ZodError into a compact, client-friendly list. */
export function formatIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}
