import { describe, it, expect, vi } from "vitest";
import { Position, RiskProfile, Signal, Policy } from "@intentguard/core";
import { scanPositions } from "../src/drift.js";

const ADDR = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

const POLICY: Policy = {
  maxRiskTier: 2,
  maxFeeBps: 50,
  maxNotionalPerTx: 10_000_000000n,
  dailyBudget: 25_000_000000n,
  minFillDeadline: 1800,
  allowedSettlersRoot: ("0x" + "ab".repeat(32)) as `0x${string}`,
  expiry: Math.floor(Date.now() / 1000) + 365 * 86400,
};

function signal(id: string, tier: 1 | 2 | 3 | 4, detail = "test"): Signal {
  return {
    id,
    label: id,
    value: detail,
    tierContribution: tier,
    source: { kind: "rpc", detail },
    observedAt: Date.now(),
    ok: true,
  };
}

function profile(tier: 1 | 2 | 3 | 4, signals: Signal[], settler: `0x${string}` = ADDR(1)): RiskProfile {
  return { settler, tier, signals, rationale: [], computedAt: Date.now() };
}

function position(tierAtOpen: 1 | 2 | 3 | 4, signalsAtOpen: Signal[]): Position {
  return {
    id: "pos-1",
    settler: ADDR(1),
    protocolSlug: "demo",
    amountUsd: 5000,
    openedAt: Date.now() - 3600_000,
    tierAtOpen,
    signalsAtOpen,
    policySnapshot: POLICY,
  };
}

describe("drift monitor", () => {
  it("detects proxy upgrade (admin change to EOA)", async () => {
    const pos = position(1, [signal("upgradeability", 1, "Safe 4-of-7 + 48h timelock")]);
    const score = vi.fn(async () =>
      profile(4, [signal("upgradeability", 4, "admin changed from Safe 4-of-7 to EOA 0xabc…")]),
    );
    const res = await scanPositions([pos], score);
    expect(res.driftEvents).toHaveLength(1);
    expect(res.driftEvents[0].to).toBe(4);
    expect(res.driftEvents[0].cause).toContain("upgradeability");
    expect(res.driftEvents[0].cause).toContain("EOA");
  });

  it("detects TVL collapse", async () => {
    const pos = position(1, [signal("liquidity", 1, "TVL $50M")]);
    const score = vi.fn(async () => profile(4, [signal("liquidity", 4, "TVL down 70%")]));
    const res = await scanPositions([pos], score);
    expect(res.driftEvents).toHaveLength(1);
    expect(res.driftEvents[0].cause).toContain("liquidity");
  });

  it("detects new incident", async () => {
    const pos = position(1, [signal("incidents", 1, "none")]);
    const score = vi.fn(async () => profile(4, [signal("incidents", 4, "hack reported 2d ago")]));
    const res = await scanPositions([pos], score);
    expect(res.driftEvents).toHaveLength(1);
    expect(res.driftEvents[0].cause).toContain("incidents");
  });

  it("no drift when nothing changes", async () => {
    const signals = [signal("upgradeability", 1, "Safe")];
    const pos = position(1, signals);
    const score = vi.fn(async () => profile(1, signals));
    const res = await scanPositions([pos], score);
    expect(res.driftEvents).toHaveLength(0);
    expect(res.escalations).toHaveLength(0);
  });

  it("does not escalate within-policy drift", async () => {
    const pos = position(1, [signal("liquidity", 1, "TVL $50M")]);
    const score = vi.fn(async () => profile(2, [signal("liquidity", 2, "TVL $20M")]));
    const res = await scanPositions([pos], score);
    expect(res.driftEvents).toHaveLength(1);
    expect(res.escalations).toHaveLength(0);
  });

  it("escalation pauses the vault (kill switch path)", async () => {
    const pos = position(1, [signal("upgradeability", 1, "Safe")]);
    const score = vi.fn(async () => profile(4, [signal("upgradeability", 4, "admin is EOA")]));
    const res = await scanPositions([pos], score);
    expect(res.escalations).toHaveLength(1);
  });

  it("drift cause is human-readable", async () => {
    const pos = position(2, [signal("upgradeability", 2, "Safe 3-of-5")]);
    const score = vi.fn(async () => profile(4, [signal("upgradeability", 4, "admin is EOA 0xabc")]));
    const res = await scanPositions([pos], score);
    expect(res.driftEvents[0].cause).toMatch(/upgradeability: tier 2 → 4/);
  });

  it("monitor survives a transient RPC failure", async () => {
    const pos = position(1, [signal("upgradeability", 1, "Safe")]);
    const score = vi
      .fn()
      .mockRejectedValueOnce(new Error("RPC timeout"))
      .mockResolvedValueOnce(profile(1, [signal("upgradeability", 1, "Safe")]));
    const res = await scanPositions([pos], score);
    expect(res.errors).toHaveLength(1);
    expect(res.escalations).toHaveLength(0);
    const res2 = await scanPositions([pos], score);
    expect(res2.errors).toHaveLength(0);
  });
});
