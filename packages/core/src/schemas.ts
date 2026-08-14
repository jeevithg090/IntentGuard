import { z } from "zod";

export const AddressSchema = z.custom<`0x${string}`>((v) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v));

export const Bytes32Schema = z.custom<`0x${string}`>((v) => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v));

export const RiskTierSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

export const SignalSourceSchema = z.object({
  kind: z.enum(["rpc", "http"]),
  detail: z.string(),
  url: z.string().optional(),
});

export const SignalSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  tierContribution: RiskTierSchema,
  source: SignalSourceSchema,
  observedAt: z.number(),
  blockNumber: z.bigint().optional(),
  ok: z.boolean(),
});

export const RiskProfileSchema = z.object({
  settler: AddressSchema,
  tier: RiskTierSchema,
  signals: z.array(SignalSchema),
  rationale: z.array(z.string()),
  computedAt: z.number(),
});

export const PolicySchema = z.object({
  maxRiskTier: RiskTierSchema,
  maxFeeBps: z.number().int().min(0),
  maxNotionalPerTx: z.bigint(),
  dailyBudget: z.bigint(),
  minFillDeadline: z.number().int().min(0),
  allowedSettlersRoot: Bytes32Schema,
  expiry: z.number().int(),
});

export const QuoteSchema = z.object({
  id: z.string(),
  solverId: z.string(),
  solverName: z.string(),
  tokenSymbol: z.string(),
  tokenAddress: AddressSchema,
  protocolSlug: z.string(),
  protocolDescription: z.string(),
  annotations: z.string(),
  destinationChainId: z.number().int(),
  inputAmountUsd: z.number().positive(),
  expectedOutputUsd: z.number().positive(),
  expectedOutputTokens: z.bigint(),
  executionSeconds: z.number().int().positive(),
  feeBps: z.number().int().min(0),
  quotedSlippageBps: z.number().int().min(0),
  settler: AddressSchema,
});

export const ObjectionSchema = z.object({
  severity: z.enum(["low", "medium", "high", "critical"]),
  claim: z.string(),
  failureChain: z.string(),
  evidenceSignalIds: z.array(z.string()),
});

export const InjectionAttemptSchema = z.object({
  field: z.string(),
  quotedText: z.string(),
});

export const ProposerOutputSchema = z.object({
  recommendedSolverId: z.string(),
  expectedValueUsd: z.number(),
  argument: z.string(),
  acknowledgedTradeoffs: z.array(z.string()),
});

export const RedTeamOutputSchema = z.object({
  objections: z.array(ObjectionSchema),
  injectionAttemptsDetected: z.array(InjectionAttemptSchema),
  recommendation: z.enum(["proceed", "proceed_with_caution", "reject"]),
});

export const ArbiterOutputSchema = z.object({
  verdict: z.enum(["EXECUTE", "ASK", "REFUSE"]),
  selectedSolverId: z.string().nullable(),
  reasoning: z.string(),
  upheldObjections: z.array(z.string()),
  dismissedObjections: z.array(z.string()),
});

export const SimulationAssertionSchema = z.object({
  id: z.string(),
  label: z.string(),
  passed: z.boolean(),
  observed: z.string(),
});

export const SimulationResultSchema = z.object({
  blockNumber: z.bigint(),
  assertions: z.array(SimulationAssertionSchema),
  simHash: AddressSchema,
});

export const AttestationSchema = z.object({
  orderId: AddressSchema,
  riskTier: RiskTierSchema,
  feeBps: z.number().int().min(0),
  simHash: AddressSchema,
  expiry: z.number().int(),
  nonce: z.bigint(),
  signature: AddressSchema,
});
