import { Signal, RiskTier } from "@intentguard/core";

const LLAMA_HACKS = "https://api.llama.fi/hacks";
const FETCH_TIMEOUT_MS = 10_000;

const fail = (detail: string): Signal => ({
  id: "incidents",
  label: "Incident history",
  value: null,
  tierContribution: 4,
  source: { kind: "http", detail, url: LLAMA_HACKS },
  observedAt: Date.now(),
  ok: false,
});

export interface IncidentFacts {
  recent: { name: string; date: number; fundsLostUsd: number | null }[];
  matchedSlug: string;
  windowDays: number;
  tier: RiskTier;
}

interface HackEntry {
  name?: string;
  date?: number;
  amount?: number;
}

/** Match by protocol name, case-insensitive substring; recent = within 180 days. */
export async function scoreIncidents(slug: string, fetchFn: typeof fetch = fetch): Promise<Signal> {
  try {
    const res = await fetchFn(LLAMA_HACKS, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return fail(`DefiLlama hacks API HTTP ${res.status}`);
    const data = (await res.json()) as HackEntry[];
    if (!Array.isArray(data)) return fail("DefiLlama hacks API returned non-array");

    const now = Date.now();
    const WINDOW = 180 * 86400 * 1000;
    const needle = slug.toLowerCase();
    const recent = data
      .filter((h) => typeof h.name === "string" && h.name.toLowerCase().includes(needle))
      .filter((h) => typeof h.date === "number" && now - h.date * 1000 <= WINDOW)
      .map((h) => ({ name: h.name!, date: h.date!, fundsLostUsd: typeof h.amount === "number" ? h.amount : null }))
      .sort((a, b) => b.date - a.date);

    const tier: RiskTier = recent.length > 0 ? 4 : 1;
    const facts: IncidentFacts = { recent, matchedSlug: slug, windowDays: 180, tier };
    const detail =
      recent.length > 0
        ? `GET ${LLAMA_HACKS} → ${recent.length} incident(s) for "${slug}" in last 180d: ${recent.map((r) => `${r.name} (${new Date(r.date * 1000).toISOString().slice(0, 10)})`).join(", ")}`
        : `GET ${LLAMA_HACKS} → no incidents for "${slug}" in last 180d`;

    return {
      id: "incidents",
      label: "Incident history",
      value: JSON.stringify(facts),
      tierContribution: tier,
      source: { kind: "http", detail, url: LLAMA_HACKS },
      observedAt: Date.now(),
      ok: true,
    };
  } catch (e) {
    return fail(`hacks fetch failed: ${(e as Error).message}`);
  }
}
