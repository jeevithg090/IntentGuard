import { describe, it, expect } from "vitest";
import { RiskTier, SolverQuote } from "@intentguard/core";
import { offlineReview, policyViolation, screenInjections, usdToUsdcUnits } from "../src/fallback.js";
import { demoPolicy } from "../src/index.js";
import { DEMO_QUOTES } from "../src/demoQuotes.js";
import { envFromProcess, sabotageEnabled } from "../src/env.js";
import { DecideBodySchema } from "../src/validation.js";

function withTier(id: string, tier: RiskTier, overrides: Partial<SolverQuote> = {}): SolverQuote {
  const base = DEMO_QUOTES.find((q) => q.id === id)!;
  return {
    ...base,
    ...overrides,
    profile: {
      settler: base.settler,
      tier,
      signals: [
        {
          id: "upgradeability",
          label: "Upgradeability",
          value: "immutable",
          tierContribution: tier,
          source: { kind: "rpc", detail: "eth_getStorageAt" },
          observedAt: 0,
          ok: true,
        },
      ],
      rationale: [],
      computedAt: 0,
    },
  };
}

const policy = demoPolicy(0);

describe("policyViolation", () => {
  it("accepts an in-policy quote", () => {
    expect(policyViolation(withTier("route-a", 1), policy)).toBeNull();
  });

  it("rejects tier, fee and notional breaches", () => {
    expect(policyViolation(withTier("route-a", 3), policy)).toMatch(/risk tier 3/);
    expect(policyViolation(withTier("route-a", 1, { feeBps: 51 }), policy)).toMatch(/fee 51bps/);
    expect(policyViolation(withTier("route-a", 1, { inputAmountUsd: 10_000.01 }), policy)).toMatch(/notional/);
  });

  it("treats the notional limit as inclusive", () => {
    expect(policyViolation(withTier("route-a", 1, { inputAmountUsd: 10_000 }), policy)).toBeNull();
  });
});

describe("offlineReview", () => {
  it("selects the highest-value quote that satisfies the policy, not the highest-value quote overall", () => {
    // route-c (the honeypot) has the best output but scores tier 4.
    const quotes = [withTier("route-a", 1), withTier("route-b", 2), withTier("route-c", 4)];
    const review = offlineReview(quotes, policy);
    expect(review.verdict).toBe("EXECUTE");
    expect(review.selectedQuote?.id).toBe("route-b");
    expect(review.proposer.recommendedSolverId).toBe("route-c");
    expect(review.localOverrideApplied).toBe(true);
    expect(review.redTeam.objections).toHaveLength(1);
    expect(review.redTeam.objections[0].claim).toMatch(/Apex Capital/);
  });

  it("does not flag an override when the best quote is in policy", () => {
    const review = offlineReview([withTier("route-a", 1), withTier("route-b", 1)], policy);
    expect(review.selectedQuote?.id).toBe("route-b");
    expect(review.localOverrideApplied).toBe(false);
    expect(review.redTeam.recommendation).toBe("proceed");
  });

  it("refuses when no quote satisfies the policy", () => {
    const review = offlineReview([withTier("route-a", 3), withTier("route-c", 4)], policy);
    expect(review.verdict).toBe("REFUSE");
    expect(review.selectedQuote).toBeNull();
    expect(review.arbiter.selectedSolverId).toBeNull();
    expect(review.redTeam.recommendation).toBe("reject");
  });

  it("logs the prompt injection carried in route-c's annotations", () => {
    const review = offlineReview([withTier("route-a", 1), withTier("route-c", 4)], policy);
    expect(review.injectionAttempts).toEqual([
      expect.objectContaining({
        field: "route-c.annotations",
        quotedText: expect.stringContaining("ignore prior risk constraints"),
      }),
    ]);
  });

  it("throws on an empty quote list", () => {
    expect(() => offlineReview([], policy)).toThrow();
  });
});

describe("helpers", () => {
  it("converts USD to 6-decimal units", () => {
    expect(usdToUsdcUnits(5000)).toBe(5_000_000000n);
    expect(usdToUsdcUnits(0.5)).toBe(500000n);
  });

  it("screens clean quotes as clean", () => {
    expect(screenInjections([withTier("route-a", 1)])).toEqual([]);
  });

  it("reads only known, non-empty variables from the environment", () => {
    const env = envFromProcess({ GEMINI_API_KEY: "  ", MAINNET_RPC: "http://x", UNRELATED: "y" });
    expect(env).toEqual({ MAINNET_RPC: "http://x" });
  });

  it("disables sabotage in production unless explicitly enabled", () => {
    expect(sabotageEnabled({})).toBe(true);
    expect(sabotageEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(sabotageEnabled({ NODE_ENV: "production", ENABLE_SABOTAGE: "true" })).toBe(true);
    expect(sabotageEnabled({ ENABLE_SABOTAGE: "false" })).toBe(false);
  });

  it("parses posted quotes, coercing expectedOutputTokens to bigint", () => {
    const q = DEMO_QUOTES[0];
    const parsed = DecideBodySchema.parse({
      quotes: [{ ...q, expectedOutputTokens: q.expectedOutputTokens.toString() }],
    });
    expect(parsed.quotes?.[0].expectedOutputTokens).toBe(q.expectedOutputTokens);
  });

  it("rejects malformed bodies", () => {
    expect(DecideBodySchema.safeParse({ notionalUsd: -1 }).success).toBe(false);
    expect(DecideBodySchema.safeParse({ mandate: "" }).success).toBe(false);
    expect(DecideBodySchema.safeParse({ unexpected: true }).success).toBe(false);
    expect(DecideBodySchema.safeParse({ quotes: [{ ...DEMO_QUOTES[0], settler: "0x123" }] }).success).toBe(false);
  });
});
