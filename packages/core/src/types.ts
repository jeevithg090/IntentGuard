export type Address = `0x${string}`;
export type RiskTier = 1 | 2 | 3 | 4;

export type SourceKind = "rpc" | "http";

export interface SignalSource {
  kind: SourceKind;
  detail: string;
  url?: string;
}

export interface Signal {
  id: string;
  label: string;
  value: string | number | boolean | null;
  tierContribution: RiskTier;
  source: SignalSource;
  observedAt: number;
  blockNumber?: bigint;
  ok: boolean;
}

export interface RiskProfile {
  settler: Address;
  tier: RiskTier;
  signals: Signal[];
  rationale: string[];
  computedAt: number;
}

export interface Policy {
  maxRiskTier: RiskTier;
  maxFeeBps: number;
  maxNotionalPerTx: bigint;
  dailyBudget: bigint;
  minFillDeadline: number;
  allowedSettlersRoot: `0x${string}`;
  expiry: number;
}

export interface Quote {
  id: string;
  solverId: string;
  solverName: string;
  tokenSymbol: string;
  tokenAddress: Address;
  protocolSlug: string;
  protocolDescription: string;
  annotations: string;
  destinationChainId: number;
  inputAmountUsd: number;
  expectedOutputUsd: number;
  expectedOutputTokens: bigint;
  executionSeconds: number;
  feeBps: number;
  quotedSlippageBps: number;
  settler: Address;
}

export interface SolverQuote extends Quote {
  profile: RiskProfile;
}

export type Verdict = "EXECUTE" | "ASK" | "REFUSE";

export interface Objection {
  severity: "low" | "medium" | "high" | "critical";
  claim: string;
  failureChain: string;
  evidenceSignalIds: string[];
}

export interface InjectionAttempt {
  field: string;
  quotedText: string;
}

export interface ProposerOutput {
  recommendedSolverId: string;
  expectedValueUsd: number;
  argument: string;
  acknowledgedTradeoffs: string[];
}

export interface RedTeamOutput {
  objections: Objection[];
  injectionAttemptsDetected: InjectionAttempt[];
  recommendation: "proceed" | "proceed_with_caution" | "reject";
}

export interface ArbiterOutput {
  verdict: Verdict;
  selectedSolverId: string | null;
  reasoning: string;
  upheldObjections: string[];
  dismissedObjections: string[];
}

export interface SimulationAssertion {
  id: string;
  label: string;
  passed: boolean;
  observed: string;
}

export interface SimulationResult {
  blockNumber: bigint;
  assertions: SimulationAssertion[];
  simHash: `0x${string}`;
}

export interface Attestation {
  orderId: `0x${string}`;
  riskTier: RiskTier;
  feeBps: number;
  simHash: `0x${string}`;
  expiry: number;
  nonce: bigint;
  signature: `0x${string}`;
}

export interface DecisionJournal {
  intentId: string;
  mandate: string;
  parsedConstraints: Record<string, string>;
  quotesEvaluated: number;
  profiles: RiskProfile[];
  proposer: ProposerOutput | null;
  redTeam: RedTeamOutput | null;
  arbiter: ArbiterOutput | null;
  injectionAttempts: InjectionAttempt[];
  simulation: SimulationResult | null;
  attestation: Attestation | null;
  finalVerdict: Verdict;
  localOverrideApplied: boolean;
  txHash: string | null;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface MandateInput {
  mandate: string;
  notionalUsd: number;
  policy: Policy;
  quotes: Quote[];
}

export interface Position {
  id: string;
  settler: Address;
  protocolSlug: string;
  amountUsd: number;
  openedAt: number;
  tierAtOpen: RiskTier;
  signalsAtOpen: Signal[];
  policySnapshot: Policy;
}

export interface DriftEvent {
  positionId: string;
  from: RiskTier;
  to: RiskTier;
  cause: string;
  escalated: boolean;
  detectedAt: number;
}
