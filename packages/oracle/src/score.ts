import { PublicClient, Address } from "viem";
import { RiskProfile, RiskTier, Signal } from "@intentguard/core";
import { scoreUpgradeability } from "./signals/upgradeability.js";
import { scoreLiquidity } from "./signals/liquidity.js";
import { scoreIncidents } from "./signals/incidents.js";
import { scoreSolverHistory } from "./signals/solverHistory.js";

export interface ScoreRouteInput {
  settler: Address;
  protocolSlug: string;
  fetchFn?: typeof fetch;
}

/**
 * Compute a RiskProfile for a route. The overall tier is the MAX of the signal
 * contributions — one catastrophic factor is never diluted by benign ones.
 * Fail-closed: any signal with ok=false contributes tier 4.
 */
export async function scoreRoute(client: PublicClient, input: ScoreRouteInput): Promise<RiskProfile> {
  const [upgradeability, liquidity, incidents, solverHistory] = await Promise.all([
    scoreUpgradeability(client, input.settler),
    scoreLiquidity(input.protocolSlug, input.fetchFn),
    scoreIncidents(input.protocolSlug, input.fetchFn),
    scoreSolverHistory(client, input.settler),
  ]);

  const signals: Signal[] = [upgradeability, liquidity, incidents, solverHistory];
  const tier = Math.max(...signals.map((s) => s.tierContribution)) as RiskTier;

  const rationale: string[] = [];
  for (const s of signals) {
    if (!s.ok) rationale.push(`${s.id}: fetch failed → scored tier 4 (fail-closed)`);
    else if (s.tierContribution === tier) rationale.push(`${s.id}: ${s.source.detail} → tier ${s.tierContribution}`);
  }

  return {
    settler: input.settler,
    tier,
    signals,
    rationale,
    computedAt: Date.now(),
  };
}

/** Render each signal as a provenance card: value → source → query → when. */
export interface ProvenanceCard {
  id: string;
  label: string;
  value: string;
  tier: RiskTier;
  ok: boolean;
  sourceKind: "rpc" | "http";
  query: string;
  url?: string;
  observedAt: number;
  blockNumber?: string;
}

export function provenanceCards(profile: RiskProfile): ProvenanceCard[] {
  return profile.signals.map((s) => ({
    id: s.id,
    label: s.label,
    value: s.value === null ? "unavailable (fail-closed → tier 4)" : String(s.value),
    tier: s.tierContribution,
    ok: s.ok,
    sourceKind: s.source.kind,
    query: s.source.detail,
    url: s.source.url,
    observedAt: s.observedAt,
    blockNumber: s.blockNumber !== undefined ? s.blockNumber.toString() : undefined,
  }));
}
