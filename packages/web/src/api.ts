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
// (e.g. Vercel) there is no backend, so these calls fail with an `ApiError` of
// kind "offline" that the UI turns into a "run the API or try Demo Mode" hint,
// rather than surfacing a raw parse error.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: "offline" | "rejected" | "server",
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const NO_BACKEND =
  "This is the static frontend, so there is no API to talk to. Run the API locally " +
  "(pnpm dev:api) for live decisions and the on-chain sabotage proof, or use Demo Mode.";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(NO_BACKEND, "offline");
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) throw new ApiError(NO_BACKEND, "offline", res.status);
  const body = (await res.json()) as unknown;
  if (res.ok) return body as T;

  // A failed decision still returns its journal (with `error` set); keep it so
  // the UI can show what happened up to the failure.
  if (body && typeof body === "object" && "intentId" in body) return body as T;

  const b = body as { error?: string; issues?: { path: string; message: string }[] };
  const detail = b.issues?.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; ");
  const message = [b.error ?? `Request failed (${res.status})`, detail].filter(Boolean).join(" — ");
  throw new ApiError(message, res.status >= 500 ? "server" : "rejected", res.status);
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
