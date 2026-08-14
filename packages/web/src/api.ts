export interface ProvenanceCard {
  id: string;
  label: string;
  value: string;
  tier: 1 | 2 | 3 | 4;
  ok: boolean;
  sourceKind: "rpc" | "http";
  query: string;
  url?: string;
  observedAt: number;
  blockNumber?: string;
}

export interface Journal {
  intentId: string;
  mandate: string;
  parsedConstraints: Record<string, string>;
  quotesEvaluated: number;
  profiles: {
    settler: string;
    tier: 1 | 2 | 3 | 4;
    signals: {
      id: string;
      label: string;
      value: string | number | boolean | null;
      tierContribution: 1 | 2 | 3 | 4;
      source: { kind: string; detail: string; url?: string };
      observedAt: number;
      blockNumber?: string;
      ok: boolean;
    }[];
    rationale: string[];
  }[];
  proposer: {
    recommendedSolverId: string;
    expectedValueUsd: number;
    argument: string;
    acknowledgedTradeoffs: string[];
  } | null;
  redTeam: {
    objections: { severity: string; claim: string; failureChain: string; evidenceSignalIds: string[] }[];
    injectionAttemptsDetected: { field: string; quotedText: string }[];
    recommendation: string;
  } | null;
  arbiter: {
    verdict: "EXECUTE" | "ASK" | "REFUSE";
    selectedSolverId: string | null;
    reasoning: string;
    upheldObjections: string[];
    dismissedObjections: string[];
  } | null;
  injectionAttempts: { field: string; quotedText: string }[];
  simulation: {
    blockNumber: string;
    assertions: { id: string; label: string; passed: boolean; observed: string }[];
    simHash: string;
  } | null;
  attestation: {
    orderId: string;
    riskTier: 1 | 2 | 3 | 4;
    feeBps: number;
    simHash: string;
    expiry: number;
    nonce: string;
    signature: string;
  } | null;
  finalVerdict: "EXECUTE" | "ASK" | "REFUSE";
  localOverrideApplied: boolean;
  txHash: string | null;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
}

// The frontend talks to the IntentGuard API at /api/*. On a static deploy
// (e.g. Vercel) there is no backend, so these calls fail cleanly with a message
// explaining how to run the full stack, rather than throwing a raw parse error.
const NO_BACKEND =
  "No backend connected. This is the static frontend — run the API locally " +
  "(pnpm --filter @intentguard/api dev) to enable live decisions and the on-chain sabotage proof.";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new Error(NO_BACKEND);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!res.ok || !ct.includes("application/json")) {
    throw new Error(NO_BACKEND);
  }
  return res.json() as Promise<T>;
}

export async function decide(mandate: string): Promise<Journal> {
  return call<Journal>("/api/decide", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mandate }),
  });
}

export async function sabotage(routeId: string, tier: 1 | 2 | 3 | 4): Promise<Journal> {
  return call<Journal>("/api/sabotage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ routeId, tier }),
  });
}

export async function getJournals(): Promise<Journal[]> {
  return call<Journal[]>("/api/journals");
}

export async function getProvenance(settler: string): Promise<{ cards: ProvenanceCard[] }> {
  return call<{ cards: ProvenanceCard[] }>(`/api/provenance/${settler}`);
}

export const TIER_COLORS: Record<number, string> = {
  1: "text-ok border-ok/40 bg-ok/10",
  2: "text-emerald-300 border-emerald-400/40 bg-emerald-400/10",
  3: "text-warn border-warn/40 bg-warn/10",
  4: "text-danger border-danger/40 bg-danger/10",
};
