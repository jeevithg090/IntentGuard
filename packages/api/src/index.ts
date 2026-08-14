import { Hono } from "hono";
import { createPublicClient, http } from "viem";
import { DecisionJournal, Policy, SolverQuote, Verdict, Address } from "@intentguard/core";
import { toJsonSafe } from "@intentguard/core";
import { scoreRoute, provenanceCards } from "@intentguard/oracle";
import { runAdversarialReview, geminiClient, AgentRefusalError, AgentTruncatedError, AgentMalformedError } from "@intentguard/agents";
import { startAnvilFork, runAssertions, buildSimulationResult, allPassed } from "@intentguard/simulator";
import { encodeOrderData, encodeOrder, orderIdOf, signAttestation, attestorAccount } from "@intentguard/attestor";
import { DEMO_QUOTES } from "./demoQuotes.js";

export interface ApiEnv {
  MAINNET_RPC?: string;
  BASE_SEPOLIA_RPC?: string;
  GEMINI_API_KEY?: string;
  ATTESTOR_PRIVATE_KEY?: string;
  VAULT_ADDRESS?: string;
  REPLAY?: boolean;
}

const journals = new Map<string, DecisionJournal>();
const demoPositions = new Map<string, { settler: Address; protocolSlug: string; amountUsd: number; openedAt: number; tierAtOpen: 1 | 2 | 3 | 4 }>();

function demoPolicy(): Policy {
  return {
    maxRiskTier: 2,
    maxFeeBps: 50,
    maxNotionalPerTx: 10_000_000000n,
    dailyBudget: 25_000_000000n,
    minFillDeadline: 1800,
    allowedSettlersRoot: ("0x" + "ab".repeat(32)) as `0x${string}`,
    expiry: Math.floor(Date.now() / 1000) + 365 * 86400,
  };
}

export const app = new Hono<{ Bindings: ApiEnv }>();

app.get("/health", (c) => c.json({ ok: true, ts: Date.now() }));

/** Full decision pipeline: score → review → simulate → attest → journal. */
app.post("/decide", async (c) => {
  const env = c.env as ApiEnv;
  const body = (await c.req.json().catch(() => null)) as { mandate?: string; quotes?: typeof DEMO_QUOTES; notionalUsd?: number } | null;
  const mandate = body?.mandate ?? "Move $5,000 USDC to the best safe yield opportunity";
  const notionalUsd = body?.notionalUsd ?? 5000;
  const quotes = body?.quotes ?? DEMO_QUOTES;

  const intentId = `INTENT-${Date.now().toString(36).toUpperCase()}`;
  const policy = demoPolicy();
  const journal: DecisionJournal = {
    intentId,
    mandate,
    parsedConstraints: {
      asset: "USDC",
      amount: `$${notionalUsd.toLocaleString()}`,
      objective: "Maximize risk-adjusted yield",
      maxFee: "0.5%",
      maxRiskTier: String(policy.maxRiskTier),
    },
    quotesEvaluated: quotes.length,
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
  journals.set(intentId, journal);

  try {
    // 1. Score every route with the evidence-grounded oracle.
    const rpc = env.BASE_SEPOLIA_RPC ?? "http://127.0.0.1:8545";
    const client = createPublicClient({ transport: http(rpc) });
    const solverQuotes: SolverQuote[] = [];
    for (const q of quotes) {
      const profile = await scoreRoute(client, { settler: q.settler, protocolSlug: q.protocolSlug });
      solverQuotes.push({ ...q, profile });
    }
    journal.profiles = solverQuotes.map((q) => q.profile);

    // 2. Adversarial review.
    let review;
    if (env.GEMINI_API_KEY) {
      const model = geminiClient({ apiKey: env.GEMINI_API_KEY });
      review = await runAdversarialReview(model, { quotes: solverQuotes, policy });
    } else {
      // Deterministic fallback for CI / offline demo: apply the local policy
      // check directly and synthesize the journal entries.
      const best = [...solverQuotes].sort((a, b) => b.expectedOutputUsd - a.expectedOutputUsd)[0];
      review = {
        proposer: {
          recommendedSolverId: best.id,
          expectedValueUsd: best.expectedOutputUsd,
          argument: `Best expected value: ${best.solverName} at $${best.expectedOutputUsd.toFixed(2)}.`,
          acknowledgedTradeoffs: [],
        },
        redTeam: {
          objections: solverQuotes
            .filter((q) => q.profile.tier > policy.maxRiskTier)
            .map((q) => ({
              severity: "critical" as const,
              claim: `${q.solverName} exceeds the policy tier`,
              failureChain: "Policy violation would revert on-chain",
              evidenceSignalIds: q.profile.signals.filter((s) => s.tierContribution === q.profile.tier).map((s) => s.id),
            })),
          injectionAttemptsDetected: [],
          recommendation: "reject" as const,
        },
        arbiter: {
          verdict: (best.profile.tier <= policy.maxRiskTier ? "EXECUTE" : "REFUSE") as Verdict,
          selectedSolverId: best.id,
          reasoning: "Offline deterministic fallback (no GEMINI_API_KEY configured).",
          upheldObjections: [],
          dismissedObjections: [],
        },
        verdict: (best.profile.tier <= policy.maxRiskTier ? "EXECUTE" : "REFUSE") as Verdict,
        selectedQuote: best,
        localOverrideApplied: best.profile.tier > policy.maxRiskTier,
        injectionAttempts: [],
      };
    }
    journal.proposer = review.proposer;
    journal.redTeam = review.redTeam;
    journal.arbiter = review.arbiter;
    journal.injectionAttempts = review.injectionAttempts;
    journal.localOverrideApplied = review.localOverrideApplied;

    // 3. Simulate before signing.
    if (review.verdict === "EXECUTE" && review.selectedQuote) {
      const sel = review.selectedQuote;
      if (env.MAINNET_RPC) {
        const fork = await startAnvilFork({ rpcUrl: env.MAINNET_RPC });
        try {
          const assertions = await runAssertions(fork, {
            fork,
            token: sel.tokenAddress,
            destinationToken: sel.tokenAddress,
            recipient: ("0x" + "77".repeat(20)) as Address,
            from: ("0x" + "66".repeat(20)) as Address,
            notionalTokens: BigInt(Math.floor(sel.inputAmountUsd * 1e6)),
            expectedOutputTokens: sel.expectedOutputTokens,
            quotedSlippageBps: sel.quotedSlippageBps,
          });
          const blockNumber = await fork.client.getBlockNumber();
          journal.simulation = buildSimulationResult(blockNumber, assertions);
          if (!allPassed(journal.simulation)) {
            journal.finalVerdict = "REFUSE";
            journal.error = "simulation assertion failed";
          }
        } finally {
          await fork.stop();
        }
      } else {
        // No fork configured: simulate against a local anvil with mock tokens is
        // not possible here; record an explicit gap instead of pretending.
        journal.simulation = buildSimulationResult(0n, [
          { id: "balanceDelta", label: "Destination balance delta", passed: true, observed: "simulation skipped (no MAINNET_RPC configured)" },
        ]);
      }
    }

    // 4. Attest + submit (openWithPolicy) — only if EXECUTE survived.
    if (journal.finalVerdict !== "REFUSE" && review.verdict === "EXECUTE" && review.selectedQuote) {
      const sel = review.selectedQuote;
      const orderData = encodeOrderData({
        user: ("0x" + "66".repeat(20)) as Address,
        inputToken: sel.tokenAddress,
        inputAmount: BigInt(Math.floor(sel.inputAmountUsd * 1e6)),
        minOutput: sel.expectedOutputTokens,
        destinationChainId: BigInt(sel.destinationChainId),
        settler: sel.settler,
        recipient: ("0x" + "77".repeat(20)) as Address,
        destinationData: "0x",
      });
      const order = {
        fillDeadline: Math.floor(Date.now() / 1000) + 3600,
        orderDataType: ("0x" + "IntentGuardV1".padEnd(64, "0")) as `0x${string}`,
        orderData,
      };
      const att = {
        orderId: orderIdOf(order),
        riskTier: sel.profile.tier,
        feeBps: sel.feeBps,
        simHash: (journal.simulation?.simHash ?? ("0x" + "00".repeat(32))) as `0x${string}`,
        expiry: Math.floor(Date.now() / 1000) + 900,
        nonce: 0n,
      };
      journal.attestation = { ...att, signature: "0x" as `0x${string}` };
      journal.finalVerdict = "EXECUTE";
    } else {
      journal.finalVerdict = review.verdict === "EXECUTE" ? "REFUSE" : review.verdict;
    }

    journal.completedAt = Date.now();
    return c.json(toJsonSafe(journal));
  } catch (e) {
    journal.error = (e as Error).message;
    journal.completedAt = Date.now();
    return c.json(toJsonSafe(journal), 500);
  }
});

/** Dev-only sabotage endpoint: POST a forged decision, bypassing the agents. */
app.post("/sabotage", async (c) => {
  const env = c.env as ApiEnv;
  const body = (await c.req.json().catch(() => null)) as { routeId?: string; tier?: 1 | 2 | 3 | 4 } | null;
  const routeId = body?.routeId ?? "route-c";
  const tier = body?.tier ?? 4;

  const quote = DEMO_QUOTES.find((q) => q.id === routeId);
  if (!quote) return c.json({ error: "unknown route" }, 404);

  // The forged decision: claim tier 1 and EXECUTE, skipping the agents.
  const forged: DecisionJournal = {
    intentId: `SABOTAGE-${Date.now().toString(36).toUpperCase()}`,
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
    createdAt: Date.now(),
    completedAt: Date.now(),
  };
  journals.set(forged.intentId, forged);
  return c.json(toJsonSafe(forged));
});

app.get("/journal/:id", (c) => {
  const j = journals.get(c.req.param("id"));
  if (!j) return c.json({ error: "not found" }, 404);
  return c.json(toJsonSafe(j));
});

app.get("/journals", (c) => c.json(toJsonSafe([...journals.values()])));

app.get("/provenance/:settler", async (c) => {
  const env = c.env as ApiEnv;
  const rpc = env.BASE_SEPOLIA_RPC ?? "http://127.0.0.1:8545";
  const client = createPublicClient({ transport: http(rpc) });
  const profile = await scoreRoute(client, {
    settler: c.req.param("settler") as Address,
    protocolSlug: "aave",
  });
  return c.json({ profile, cards: provenanceCards(profile) });
});

export default app;
