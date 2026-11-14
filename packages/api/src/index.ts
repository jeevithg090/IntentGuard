import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { createPublicClient, http, keccak256, toHex } from "viem";
import { Address, Attestation, DecisionJournal, Policy, Quote, SolverQuote, toJsonSafe } from "@intentguard/core";
import { scoreRoute, provenanceCards } from "@intentguard/oracle";
import { runAdversarialReview, geminiClient, ReviewResult } from "@intentguard/agents";
import { startAnvilFork, runAssertions, buildSimulationResult, allPassed } from "@intentguard/simulator";
import { encodeOrderData, orderIdOf, signAttestation, attestorAccount, OnchainOrder } from "@intentguard/attestor";
import { DEMO_QUOTES } from "./demoQuotes.js";
import { ApiEnv, DEFAULT_RPC, sabotageEnabled } from "./env.js";
import { offlineReview, usdToUsdcUnits } from "./fallback.js";
import { AddressParamSchema, DecideBodySchema, SabotageBodySchema, formatIssues } from "./validation.js";

export type { ApiEnv } from "./env.js";
export { envFromProcess } from "./env.js";

/** ERC-7683 orderDataType for IntentGuard orders. */
export const ORDER_DATA_TYPE = keccak256(toHex("IntentGuardV1"));

/** Placeholder demo accounts used in the order the pipeline attests to. */
const DEMO_USER = ("0x" + "66".repeat(20)) as Address;
const DEMO_RECIPIENT = ("0x" + "77".repeat(20)) as Address;
const ZERO_HASH = ("0x" + "00".repeat(32)) as `0x${string}`;

/** In-memory journal store, bounded so a long-running process cannot grow without limit. */
export const MAX_JOURNALS = 500;
const journals = new Map<string, DecisionJournal>();

function storeJournal(journal: DecisionJournal): void {
  journals.set(journal.intentId, journal);
  while (journals.size > MAX_JOURNALS) {
    const oldest = journals.keys().next().value;
    if (oldest === undefined) break;
    journals.delete(oldest);
  }
}

let intentCounter = 0;
function newId(prefix: string): string {
  intentCounter = (intentCounter + 1) % 1296;
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${intentCounter.toString(36).toUpperCase().padStart(2, "0")}`;
}

/** The demo user's committed policy: tier ≤ 2, fee ≤ 50bps, $10k/tx, $25k/day, 30 min deadline. */
export function demoPolicy(now = Date.now()): Policy {
  return {
    maxRiskTier: 2,
    maxFeeBps: 50,
    maxNotionalPerTx: 10_000_000000n,
    dailyBudget: 25_000_000000n,
    minFillDeadline: 1800,
    allowedSettlersRoot: ("0x" + "ab".repeat(32)) as `0x${string}`,
    expiry: Math.floor(now / 1000) + 365 * 86400,
  };
}

function rpcClient(env: ApiEnv) {
  return createPublicClient({ transport: http(env.BASE_SEPOLIA_RPC ?? DEFAULT_RPC) });
}

function newJournal(mandate: string, notionalUsd: number, quotesEvaluated: number, policy: Policy): DecisionJournal {
  return {
    intentId: newId("INTENT"),
    mandate,
    parsedConstraints: {
      asset: "USDC",
      amount: `$${notionalUsd.toLocaleString("en-US")}`,
      objective: "Maximize risk-adjusted yield",
      maxFee: `${(policy.maxFeeBps / 100).toFixed(2)}%`,
      maxRiskTier: String(policy.maxRiskTier),
    },
    quotesEvaluated,
    profiles: [],
    proposer: null,
    redTeam: null,
    arbiter: null,
    injectionAttempts: [],
    simulation: null,
    attestation: null,
    finalVerdict: "REFUSE",
    localOverrideApplied: false,
    txHash: null,
    error: null,
    createdAt: Date.now(),
    completedAt: null,
  };
}

/** Pre-sign simulation on an Anvil mainnet fork. Returns false if any assertion failed. */
async function simulate(env: ApiEnv, journal: DecisionJournal, sel: SolverQuote): Promise<boolean> {
  if (!env.MAINNET_RPC) {
    // No fork configured: record an explicit gap instead of pretending.
    journal.simulation = buildSimulationResult(0n, [
      {
        id: "balanceDelta",
        label: "Destination balance delta",
        passed: true,
        observed: "simulation skipped (no MAINNET_RPC configured)",
      },
    ]);
    return true;
  }
  const fork = await startAnvilFork({ rpcUrl: env.MAINNET_RPC });
  try {
    const assertions = await runAssertions(fork, {
      fork,
      token: sel.tokenAddress,
      destinationToken: sel.tokenAddress,
      recipient: DEMO_RECIPIENT,
      from: DEMO_USER,
      notionalTokens: usdToUsdcUnits(sel.inputAmountUsd),
      expectedOutputTokens: sel.expectedOutputTokens,
      quotedSlippageBps: sel.quotedSlippageBps,
    });
    const blockNumber = await fork.client.getBlockNumber();
    journal.simulation = buildSimulationResult(blockNumber, assertions);
    return allPassed(journal.simulation);
  } finally {
    await fork.stop();
  }
}

/**
 * Build the ERC-7683 order for the selected quote and its EIP-712 risk
 * attestation. The attestation is signed when ATTESTOR_PRIVATE_KEY and
 * VAULT_ADDRESS are configured; otherwise it is returned unsigned ("0x").
 */
export async function buildAttestation(
  env: ApiEnv,
  sel: SolverQuote,
  simHash: `0x${string}` = ZERO_HASH,
): Promise<{ order: OnchainOrder; attestation: Attestation }> {
  const nowSec = Math.floor(Date.now() / 1000);
  const order = {
    fillDeadline: nowSec + 3600,
    orderDataType: ORDER_DATA_TYPE,
    orderData: encodeOrderData({
      user: DEMO_USER,
      inputToken: sel.tokenAddress,
      inputAmount: usdToUsdcUnits(sel.inputAmountUsd),
      minOutput: sel.expectedOutputTokens,
      destinationChainId: BigInt(sel.destinationChainId),
      settler: sel.settler,
      recipient: DEMO_RECIPIENT,
      destinationData: "0x",
    }),
  };
  const input = {
    orderId: orderIdOf(order),
    riskTier: sel.profile.tier,
    feeBps: sel.feeBps,
    simHash,
    expiry: nowSec + 900,
    nonce: 0n,
  };

  const key = env.ATTESTOR_PRIVATE_KEY;
  const vault = env.VAULT_ADDRESS;
  if (key && vault && AddressParamSchema.safeParse(vault).success) {
    const attestation = await signAttestation(
      attestorAccount(key as `0x${string}`),
      vault as Address,
      env.BASE_SEPOLIA_RPC ?? DEFAULT_RPC,
      input,
    );
    return { order, attestation };
  }
  // Unsigned: no attestor key / vault configured. The vault would reject this.
  return { order, attestation: { ...input, signature: "0x" } };
}

export const app = new Hono<{ Bindings: ApiEnv }>();

app.use("*", async (c, next) => {
  const origins = (c.env?.CORS_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (origins.length === 0) return next();
  return cors({ origin: origins })(c, next);
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error("[intentguard-api]", err);
  return c.json({ error: "internal error" }, 500);
});

app.notFound((c) => c.json({ error: "not found" }, 404));

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

app.get("/health", (c) => c.json({ ok: true, ts: Date.now() }));

/** Full decision pipeline: score → review → simulate → attest → journal. */
app.post("/decide", async (c) => {
  const env: ApiEnv = c.env ?? {};
  const parsed = DecideBodySchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json({ error: "invalid request", issues: formatIssues(parsed.error) }, 400);

  const mandate = parsed.data.mandate ?? "Move $5,000 USDC to the best safe yield opportunity";
  const notionalUsd = parsed.data.notionalUsd ?? 5000;
  const quotes: Quote[] = parsed.data.quotes ?? DEMO_QUOTES;
  const policy = demoPolicy();
  const journal = newJournal(mandate, notionalUsd, quotes.length, policy);
  storeJournal(journal);

  try {
    // 1. Score every route with the evidence-grounded oracle.
    const client = rpcClient(env);
    const solverQuotes: SolverQuote[] = await Promise.all(
      quotes.map(async (q) => ({
        ...q,
        profile: await scoreRoute(client, { settler: q.settler, protocolSlug: q.protocolSlug }),
      })),
    );
    journal.profiles = solverQuotes.map((q) => q.profile);

    // 2. Adversarial review (Gemini when configured, deterministic otherwise).
    const review: ReviewResult = env.GEMINI_API_KEY
      ? await runAdversarialReview(geminiClient({ apiKey: env.GEMINI_API_KEY }), { quotes: solverQuotes, policy })
      : offlineReview(solverQuotes, policy);
    journal.proposer = review.proposer;
    journal.redTeam = review.redTeam;
    journal.arbiter = review.arbiter;
    journal.injectionAttempts = review.injectionAttempts;
    journal.localOverrideApplied = review.localOverrideApplied;
    journal.finalVerdict = review.verdict;

    // 3. Simulate before signing; 4. attest only if EXECUTE survives simulation.
    if (review.verdict === "EXECUTE") {
      if (!review.selectedQuote) {
        journal.finalVerdict = "REFUSE";
        journal.error = "EXECUTE verdict without a selected quote";
      } else if (!(await simulate(env, journal, review.selectedQuote))) {
        journal.finalVerdict = "REFUSE";
        journal.error = "simulation assertion failed";
      } else {
        const simHash = (journal.simulation?.simHash ?? ZERO_HASH) as `0x${string}`;
        journal.attestation = (await buildAttestation(env, review.selectedQuote, simHash)).attestation;
      }
    }

    journal.completedAt = Date.now();
    return c.json(toJsonSafe(journal));
  } catch (e) {
    console.error("[intentguard-api] /decide failed", e);
    journal.finalVerdict = "REFUSE";
    journal.error = e instanceof Error ? e.message : String(e);
    journal.completedAt = Date.now();
    return c.json(toJsonSafe(journal), 500);
  }
});

/** Dev-only sabotage endpoint: records a forged EXECUTE decision that bypasses the agents. */
app.post("/sabotage", async (c) => {
  const env: ApiEnv = c.env ?? {};
  if (!sabotageEnabled(env)) return c.json({ error: "sabotage endpoint disabled" }, 403);

  const parsed = SabotageBodySchema.safeParse(await readJson(c));
  if (!parsed.success) return c.json({ error: "invalid request", issues: formatIssues(parsed.error) }, 400);
  const routeId = parsed.data.routeId ?? "route-c";
  const tier = parsed.data.tier ?? 4;

  const quote = DEMO_QUOTES.find((q) => q.id === routeId);
  if (!quote) return c.json({ error: "unknown route" }, 404);

  const now = Date.now();
  const forged: DecisionJournal = {
    intentId: newId("SABOTAGE"),
    mandate: "FORGED DECISION (dev-only)",
    parsedConstraints: { note: "bypassed the agent pipeline entirely" },
    quotesEvaluated: 1,
    profiles: [],
    proposer: null,
    redTeam: null,
    arbiter: null,
    injectionAttempts: [],
    simulation: null,
    attestation: null,
    finalVerdict: "EXECUTE",
    localOverrideApplied: false,
    txHash: null,
    error: `submitted tier ${tier} for ${routeId} — the vault must revert RiskTierExceedsPolicy`,
    createdAt: now,
    completedAt: now,
  };
  storeJournal(forged);
  return c.json(toJsonSafe(forged));
});

app.get("/journal/:id", (c) => {
  const j = journals.get(c.req.param("id"));
  if (!j) return c.json({ error: "not found" }, 404);
  return c.json(toJsonSafe(j));
});

app.get("/journals", (c) => c.json(toJsonSafe([...journals.values()].reverse())));

app.get("/provenance/:settler", async (c) => {
  const settler = c.req.param("settler");
  if (!AddressParamSchema.safeParse(settler).success) return c.json({ error: "invalid settler address" }, 400);
  const profile = await scoreRoute(rpcClient(c.env ?? {}), { settler: settler as Address, protocolSlug: "aave" });
  return c.json(toJsonSafe({ profile, cards: provenanceCards(profile) }));
});

export default app;
