import { describe, it, expect } from "vitest";
import {
  PolicySchema,
  QuoteSchema,
  RiskProfileSchema,
  SignalSchema,
  ArbiterOutputSchema,
  RedTeamOutputSchema,
  ProposerOutputSchema,
} from "../src/schemas.js";
import { toJsonSafe, jsonSafe } from "../src/jsonSafe.js";

const ADDR = "0x" + "ab".repeat(20);

describe("core schemas", () => {
  it("validates a policy", () => {
    const policy = {
      maxRiskTier: 2,
      maxFeeBps: 50,
      maxNotionalPerTx: 10_000_000000n,
      dailyBudget: 25_000_000000n,
      minFillDeadline: 1800,
      allowedSettlersRoot: "0x" + "cd".repeat(32),
      expiry: Math.floor(Date.now() / 1000) + 365 * 86400,
    };
    expect(PolicySchema.parse(policy).maxRiskTier).toBe(2);
  });

  it("rejects a tier above 4", () => {
    expect(() =>
      PolicySchema.parse({
        maxRiskTier: 5,
        maxFeeBps: 50,
        maxNotionalPerTx: 1n,
        dailyBudget: 1n,
        minFillDeadline: 1,
        allowedSettlersRoot: "0x" + "cd".repeat(32),
        expiry: 1,
      }),
    ).toThrow();
  });

  it("validates a signal and a profile", () => {
    const signal = SignalSchema.parse({
      id: "upgradeability",
      label: "Upgradeability",
      value: "proxy",
      tierContribution: 4,
      source: { kind: "rpc", detail: "eth_getStorageAt" },
      observedAt: Date.now(),
      blockNumber: 123n,
      ok: true,
    });
    expect(signal.tierContribution).toBe(4);

    const profile = RiskProfileSchema.parse({
      settler: ADDR,
      tier: 4,
      signals: [signal],
      rationale: ["proxy admin is an EOA"],
      computedAt: Date.now(),
    });
    expect(profile.tier).toBe(4);
  });

  it("validates a quote", () => {
    const quote = QuoteSchema.parse({
      id: "a",
      solverId: "s1",
      solverName: "Demo",
      tokenSymbol: "USDC",
      tokenAddress: ADDR,
      protocolSlug: "aave",
      protocolDescription: "x",
      annotations: "",
      destinationChainId: 42161,
      inputAmountUsd: 5000,
      expectedOutputUsd: 5041,
      expectedOutputTokens: 5041_000000n,
      executionSeconds: 19,
      feeBps: 31,
      quotedSlippageBps: 12,
      settler: ADDR,
    });
    expect(quote.solverId).toBe("s1");
  });

  it("validates the three agent output schemas", () => {
    expect(
      ProposerOutputSchema.parse({
        recommendedSolverId: "b",
        expectedValueUsd: 5041,
        argument: "best value",
        acknowledgedTradeoffs: ["slower"],
      }).recommendedSolverId,
    ).toBe("b");

    expect(
      RedTeamOutputSchema.parse({
        objections: [{ severity: "high", claim: "x", failureChain: "y", evidenceSignalIds: ["upgradeability"] }],
        injectionAttemptsDetected: [],
        recommendation: "reject",
      }).objections,
    ).toHaveLength(1);

    expect(
      ArbiterOutputSchema.parse({
        verdict: "REFUSE",
        selectedSolverId: null,
        reasoning: "out of policy",
        upheldObjections: ["x"],
        dismissedObjections: [],
      }).verdict,
    ).toBe("REFUSE");
  });

  it("jsonSafe serializes bigints", () => {
    const obj = { a: 1n, nested: { b: [2n, 3n] }, c: "str" };
    expect(toJsonSafe(obj)).toEqual({ a: "1", nested: { b: ["2", "3"] }, c: "str" });
    expect(jsonSafe(obj)).not.toContain("1n");
  });
});

describe("attestation & simulation schemas", () => {
  const H32 = "0x" + "cd".repeat(32);

  it("accepts 32-byte orderId/simHash and a 65-byte signature", async () => {
    const { AttestationSchema, SimulationResultSchema } = await import("../src/schemas.js");
    const att = {
      orderId: H32,
      riskTier: 2,
      feeBps: 31,
      simHash: H32,
      expiry: 1_900_000_000,
      nonce: 0n,
      signature: "0x" + "11".repeat(65),
    };
    expect(AttestationSchema.safeParse(att).success).toBe(true);
    expect(SimulationResultSchema.safeParse({ blockNumber: 1n, assertions: [], simHash: H32 }).success).toBe(true);
  });

  it("rejects 20-byte values where a bytes32 is required", async () => {
    const { AttestationSchema, SimulationResultSchema } = await import("../src/schemas.js");
    const ADDR20 = "0x" + "ab".repeat(20);
    expect(SimulationResultSchema.safeParse({ blockNumber: 1n, assertions: [], simHash: ADDR20 }).success).toBe(false);
    expect(
      AttestationSchema.safeParse({
        orderId: ADDR20,
        riskTier: 2,
        feeBps: 0,
        simHash: H32,
        expiry: 0,
        nonce: 0n,
        signature: "0x",
      }).success,
    ).toBe(false);
  });

  it("rejects odd-length or non-hex signatures", async () => {
    const { HexSchema } = await import("../src/schemas.js");
    expect(HexSchema.safeParse("0x123").success).toBe(false);
    expect(HexSchema.safeParse("0xzz").success).toBe(false);
    expect(HexSchema.safeParse("0x").success).toBe(true);
  });
});
