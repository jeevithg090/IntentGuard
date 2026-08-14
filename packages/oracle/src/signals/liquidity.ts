import { Signal, RiskTier } from "@intentguard/core";

const LLAMA_PROTOCOL = "https://api.llama.fi/protocol/{slug}";

const fail = (slug: string, detail: string): Signal => ({
  id: "liquidity",
  label: "Liquidity (TVL + trend)",
  value: null,
  tierContribution: 4,
  source: { kind: "http", detail, url: LLAMA_PROTOCOL.replace("{slug}", slug) },
  observedAt: Date.now(),
  ok: false,
});

export interface LiquidityFacts {
  slug: string;
  tvlUsd: number;
  tvl30dAgoUsd: number | null;
  trend30dPct: number | null;
  tier: RiskTier;
}

export async function scoreLiquidity(slug: string, fetchFn: typeof fetch = fetch): Promise<Signal> {
  const url = LLAMA_PROTOCOL.replace("{slug}", slug);
  try {
    const res = await fetchFn(url);
    if (!res.ok) return fail(slug, `DefiLlama protocol API HTTP ${res.status}`);
    const data = (await res.json()) as {
      tvl?: number;
      tvlPrevDay?: number;
      tvlPrevWeek?: number;
      tvlPrevMonth?: number;
      name?: string;
    };
    const tvl = data.tvl ?? 0;
    const monthAgo = data.tvlPrevMonth ?? null;
    const trend = monthAgo !== null && monthAgo > 0 ? ((tvl - monthAgo) / monthAgo) * 100 : null;

    let tier: RiskTier = 1;
    const reasons: string[] = [];
    if (tvl < 1_000_000) {
      tier = 4;
      reasons.push(`TVL $${(tvl / 1e6).toFixed(2)}M < $1M`);
    }
    if (trend !== null && trend < -50) {
      tier = 4;
      reasons.push(`30d drawdown ${trend.toFixed(1)}%`);
    } else if (trend !== null && trend < -25) {
      tier = Math.max(tier, 3) as RiskTier;
      reasons.push(`30d drawdown ${trend.toFixed(1)}%`);
    } else if (trend !== null && trend < 0) {
      tier = Math.max(tier, 2) as RiskTier;
      reasons.push(`30d trend ${trend.toFixed(1)}%`);
    }
    if (reasons.length === 0) reasons.push(`TVL $${(tvl / 1e6).toFixed(2)}M, 30d trend ${trend === null ? "n/a" : trend.toFixed(1) + "%"}`);

    const facts: LiquidityFacts = { slug, tvlUsd: tvl, tvl30dAgoUsd: monthAgo, trend30dPct: trend, tier };
    return {
      id: "liquidity",
      label: "Liquidity (TVL + trend)",
      value: JSON.stringify(facts),
      tierContribution: tier,
      source: { kind: "http", detail: `GET ${url} → TVL $${(tvl / 1e6).toFixed(2)}M; ${reasons.join("; ")}`, url },
      observedAt: Date.now(),
      ok: true,
    };
  } catch (e) {
    return fail(slug, `DefiLlama fetch failed: ${(e as Error).message}`);
  }
}
