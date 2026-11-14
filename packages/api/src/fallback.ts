import { InjectionAttempt, Policy, SolverQuote, Verdict } from "@intentguard/core";
import { ReviewResult, screenQuote } from "@intentguard/agents";

/** Convert a USD amount into 6-decimal USDC base units. */
export function usdToUsdcUnits(usd: number): bigint {
  return BigInt(Math.floor(usd * 1e6));
}

/** Why a quote cannot be executed under the policy, or null if it is eligible. */
export function policyViolation(quote: SolverQuote, policy: Policy): string | null {
  if (quote.profile.tier > policy.maxRiskTier) {
    return `risk tier ${quote.profile.tier} exceeds policy max ${policy.maxRiskTier}`;
  }
  if (quote.feeBps > policy.maxFeeBps) {
    return `fee ${quote.feeBps}bps exceeds policy max ${policy.maxFeeBps}bps`;
  }
  if (usdToUsdcUnits(quote.inputAmountUsd) > policy.maxNotionalPerTx) {
    return `notional $${quote.inputAmountUsd} exceeds the per-transaction limit`;
  }
  return null;
}

/** Deterministic injection screening over every untrusted quote field. */
export function screenInjections(quotes: SolverQuote[]): InjectionAttempt[] {
  const attempts: InjectionAttempt[] = [];
  for (const q of quotes) {
    const screened = screenQuote({
      solverName: q.solverName,
      tokenSymbol: q.tokenSymbol,
      protocolDescription: q.protocolDescription,
      annotations: q.annotations,
    });
    for (const [field, result] of Object.entries(screened)) {
      if (result.suspicious) attempts.push({ field: `${q.id}.${field}`, quotedText: result.clean });
    }
  }
  return attempts;
}

/**
 * Offline stand-in for the Gemini review, used when no GEMINI_API_KEY is set.
 *
 * The proposer argues for the highest expected output; the red team objects to
 * every out-of-policy quote; the arbiter selects the best quote that satisfies
 * the policy, or refuses if none does. `localOverrideApplied` is set when the
 * proposer's pick was rejected on policy grounds.
 */
export function offlineReview(quotes: SolverQuote[], policy: Policy): ReviewResult {
  if (quotes.length === 0) throw new Error("offlineReview requires at least one quote");

  const byValue = [...quotes].sort((a, b) => b.expectedOutputUsd - a.expectedOutputUsd);
  const best = byValue[0];
  const selected = byValue.find((q) => policyViolation(q, policy) === null) ?? null;
  const injectionAttempts = screenInjections(quotes);

  const objections = quotes.flatMap((q) => {
    const violation = policyViolation(q, policy);
    if (violation === null) return [];
    return [
      {
        severity: "critical" as const,
        claim: `${q.solverName}: ${violation}`,
        failureChain: "Executing this route would breach the committed policy; the vault would revert on-chain.",
        evidenceSignalIds: q.profile.signals.filter((s) => s.tierContribution === q.profile.tier).map((s) => s.id),
      },
    ];
  });

  const verdict: Verdict = selected ? "EXECUTE" : "REFUSE";

  return {
    proposer: {
      recommendedSolverId: best.id,
      expectedValueUsd: best.expectedOutputUsd,
      argument: `Best expected value: ${best.solverName} at $${best.expectedOutputUsd.toFixed(2)}.`,
      acknowledgedTradeoffs: [],
    },
    redTeam: {
      objections,
      injectionAttemptsDetected: [],
      recommendation: objections.length === 0 ? "proceed" : selected ? "proceed_with_caution" : "reject",
    },
    arbiter: {
      verdict,
      selectedSolverId: selected?.id ?? null,
      reasoning: selected
        ? `Offline deterministic review: ${selected.solverName} is the highest-value route within policy.`
        : "Offline deterministic review: no route satisfies the policy.",
      upheldObjections: objections.map((o) => o.claim),
      dismissedObjections: [],
    },
    verdict,
    selectedQuote: selected,
    localOverrideApplied: selected?.id !== best.id,
    injectionAttempts,
  };
}
