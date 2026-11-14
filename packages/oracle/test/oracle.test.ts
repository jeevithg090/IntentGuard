import { describe, it, expect, vi } from "vitest";
import { createPublicClient, custom } from "viem";
import { scoreUpgradeability, decodeSafeOwners } from "../src/signals/upgradeability.js";
import { scoreLiquidity } from "../src/signals/liquidity.js";
import { scoreIncidents } from "../src/signals/incidents.js";
import { scoreRoute, provenanceCards } from "../src/score.js";

const ADDR = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as const;
const TARGET = ADDR(0xabc);
const IMPL = ADDR(0x111);
const ADMIN_EOA = ADDR(0x222);
const ADMIN_SAFE = ADDR(0x333);

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

const zeroSlot = "0x0000000000000000000000000000000000000000000000000000000000000000";
const addrSlot = (a: string) => `0x000000000000000000000000${a.slice(2)}`;

function makeClient(overrides: Record<string, unknown> = {}) {
  const client = createPublicClient({
    transport: custom({
      request: async ({ method, params }) => {
        const handler = overrides[method];
        if (typeof handler === "function") return handler(params);
        if (handler !== undefined) return handler;
        throw new Error(`unexpected rpc call: ${method} ${JSON.stringify(params)}`);
      },
    }),
  }) as unknown as {
    getStorageAt: (p: { address: string; slot: string }) => Promise<string>;
    getCode: (p: { address: string }) => Promise<string>;
    getBlockNumber: () => Promise<bigint>;
    getLogs: (p: unknown) => Promise<unknown[]>;
    call: (p: { to: string; data: string }) => Promise<{ data: string }>;
    getBlock: (p: { blockNumber: bigint }) => Promise<{ timestamp: bigint }>;
  };
  return client;
}

describe("upgradeability signal", () => {
  it("detects EIP-1967 proxy", async () => {
    const client = makeClient({
      eth_getStorageAt: (params: [unknown, string]) =>
        params[1] === IMPL_SLOT ? addrSlot(IMPL) : addrSlot(ADMIN_SAFE),
      eth_getCode: () => "0x6000",
      eth_blockNumber: () => "0x10",
      eth_call: (params: [{ data: string }]) =>
        params[0].data.startsWith("0xe75235b8") || params[0].data.startsWith("0xf27a0c92")
          ? `0x${(4).toString(16).padStart(64, "0")}`
          : `0x${(0x20).toString(16).padStart(64, "0")}${(2).toString(16).padStart(64, "0")}${ADDR(1).slice(2)}${ADDR(2).slice(2)}`,
    });
    const sig = await scoreUpgradeability(client, TARGET);
    expect(sig.ok).toBe(true);
    const facts = JSON.parse(String(sig.value));
    expect(facts.isProxy).toBe(true);
    expect(facts.implementation).toBe(IMPL.toLowerCase());
  });

  it("identifies non-proxy as immutable", async () => {
    const client = makeClient({
      eth_getStorageAt: () => zeroSlot,
      eth_getCode: () => "0x6000",
      eth_blockNumber: () => "0x10",
    });
    const sig = await scoreUpgradeability(client, TARGET);
    expect(sig.ok).toBe(true);
    const facts = JSON.parse(String(sig.value));
    expect(facts.isProxy).toBe(false);
    expect(sig.tierContribution).toBe(1);
  });

  it("fails closed when the settler has no contract code", async () => {
    const client = makeClient({
      eth_getStorageAt: () => zeroSlot,
      eth_getCode: () => "0x",
      eth_blockNumber: () => "0x10",
    });
    const sig = await scoreUpgradeability(client, TARGET);
    expect(sig.ok).toBe(true);
    expect(sig.tierContribution).toBe(4);
    expect(sig.source.detail).toContain("not a deployed contract");
  });

  it("flags EOA admin as tier 4", async () => {
    const client = makeClient({
      eth_getStorageAt: (params: [unknown, string]) => (params[1] === IMPL_SLOT ? addrSlot(IMPL) : addrSlot(ADMIN_EOA)),
      eth_getCode: (params: [string]) => (params[0].toLowerCase() === ADMIN_EOA.toLowerCase() ? "0x" : "0x6000"),
      eth_blockNumber: () => "0x10",
    });
    const sig = await scoreUpgradeability(client, TARGET);
    expect(sig.tierContribution).toBe(4);
    expect(JSON.parse(String(sig.value)).adminIsContract).toBe(false);
    expect(String(sig.value)).toContain("EOA");
  });

  it("parses Safe threshold", async () => {
    const client = makeClient({
      eth_getStorageAt: (params: [unknown, string]) =>
        params[1] === IMPL_SLOT ? addrSlot(IMPL) : addrSlot(ADMIN_SAFE),
      eth_getCode: () => "0x6000",
      eth_blockNumber: () => "0x10",
      eth_call: (params: [{ data: string }]) => {
        if (params[0].data.startsWith("0xe75235b8")) return `0x${(4).toString(16).padStart(64, "0")}`;
        if (params[0].data.startsWith("0xa0e67e2b")) {
          const owners = Array.from({ length: 7 }, (_, i) => ADDR(i + 1).slice(2)).join("");
          return `0x${(0x20).toString(16).padStart(64, "0")}${(7).toString(16).padStart(64, "0")}${owners}`;
        }
        if (params[0].data.startsWith("0xf27a0c92")) return `0x${(172800).toString(16).padStart(64, "0")}`;
        throw new Error("unexpected");
      },
    });
    const sig = await scoreUpgradeability(client, TARGET);
    const facts = JSON.parse(String(sig.value));
    expect(facts.safeThreshold).toBe(4);
    expect(facts.safeOwners).toBe(7);
    expect(String(sig.value)).toContain("4-of-7");
    expect(sig.tierContribution).toBe(1); // 4-of-7 + 48h timelock
  });

  it("detects timelock delay", async () => {
    const client = makeClient({
      eth_getStorageAt: (params: [unknown, string]) =>
        params[1] === IMPL_SLOT ? addrSlot(IMPL) : addrSlot(ADMIN_SAFE),
      eth_getCode: () => "0x6000",
      eth_blockNumber: () => "0x10",
      eth_call: (params: [{ data: string }]) => {
        if (params[0].data.startsWith("0xe75235b8")) return `0x${(4).toString(16).padStart(64, "0")}`;
        if (params[0].data.startsWith("0xa0e67e2b"))
          return `0x${(0x20).toString(16).padStart(64, "0")}${(5).toString(16).padStart(64, "0")}${Array.from({ length: 5 }, (_, i) => ADDR(i + 1).slice(2)).join("")}`;
        if (params[0].data.startsWith("0xf27a0c92")) return `0x${(172800).toString(16).padStart(64, "0")}`;
        throw new Error("unexpected");
      },
    });
    const sig = await scoreUpgradeability(client, TARGET);
    expect(JSON.parse(String(sig.value)).timelockSeconds).toBe(172800);
    expect(sig.tierContribution).toBe(1);
  });

  it("no timelock lowers tier", async () => {
    const client = makeClient({
      eth_getStorageAt: (params: [unknown, string]) =>
        params[1] === IMPL_SLOT ? addrSlot(IMPL) : addrSlot(ADMIN_SAFE),
      eth_getCode: () => "0x6000",
      eth_blockNumber: () => "0x10",
      eth_call: (params: [{ data: string }]) => {
        if (params[0].data.startsWith("0xe75235b8")) return `0x${(4).toString(16).padStart(64, "0")}`;
        if (params[0].data.startsWith("0xa0e67e2b"))
          return `0x${(0x20).toString(16).padStart(64, "0")}${(5).toString(16).padStart(64, "0")}${Array.from({ length: 5 }, (_, i) => ADDR(i + 1).slice(2)).join("")}`;
        throw new Error("revert");
      },
    });
    const sig = await scoreUpgradeability(client, TARGET);
    expect(sig.tierContribution).toBe(3);
    expect(JSON.parse(String(sig.value)).timelockSeconds).toBe(null);
  });

  it("fails closed on RPC error", async () => {
    const client = makeClient({
      eth_getStorageAt: () => {
        throw new Error("boom");
      },
    });
    const sig = await scoreUpgradeability(client, TARGET);
    expect(sig.ok).toBe(false);
    expect(sig.tierContribution).toBe(4);
  });
});

describe("liquidity signal", () => {
  const base = { tvl: 12_400_000, tvlPrevMonth: 12_800_000, name: "Demo" };

  it("flags TVL drawdown", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ tvl: 4_000_000, tvlPrevMonth: 10_000_000 }) });
    const sig = await scoreLiquidity("demo", fetchFn as unknown as typeof fetch);
    expect(sig.tierContribution).toBe(4);
    expect(sig.source.detail).toContain("drawdown");
  });

  it("passes stable TVL", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => base });
    const sig = await scoreLiquidity("demo", fetchFn as unknown as typeof fetch);
    expect(sig.ok).toBe(true);
    expect(sig.tierContribution).toBeLessThanOrEqual(2);
  });

  it("fails closed on API timeout", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("timeout"));
    const sig = await scoreLiquidity("demo", fetchFn as unknown as typeof fetch);
    expect(sig.ok).toBe(false);
    expect(sig.tierContribution).toBe(4);
  });
});

describe("incidents signal", () => {
  it("flags recent incident", async () => {
    const now = Math.floor(Date.now() / 1000);
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ name: "Demo Protocol hack", date: now - 30 * 86400, amount: 1_000_000 }],
    });
    const sig = await scoreIncidents("demo", fetchFn as unknown as typeof fetch);
    expect(sig.tierContribution).toBe(4);
  });

  it("ignores stale incident", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ name: "Demo Protocol hack", date: Math.floor(Date.now() / 1000) - 3 * 365 * 86400 }],
    });
    const sig = await scoreIncidents("demo", fetchFn as unknown as typeof fetch);
    expect(sig.tierContribution).toBe(1);
    expect(JSON.parse(String(sig.value)).recent).toHaveLength(0);
  });

  it("fails closed on fetch error", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("boom"));
    const sig = await scoreIncidents("demo", fetchFn as unknown as typeof fetch);
    expect(sig.ok).toBe(false);
    expect(sig.tierContribution).toBe(4);
  });
});

describe("scoreRoute", () => {
  it("overall tier is max not mean", async () => {
    const client = makeClient({
      eth_getStorageAt: () => zeroSlot, // immutable → tier 1
      eth_blockNumber: () => "0x10",
      eth_getLogs: () => [],
    });
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    await scoreRoute(client, { settler: TARGET, protocolSlug: "demo", fetchFn: fetchFn as unknown as typeof fetch });
    // incidents for empty list = tier 1, liquidity depends on fetch... but the
    // point: an injected failing signal (e.g. liquidity timeout) forces tier 4.
    const failing = vi.fn().mockRejectedValue(new Error("timeout"));
    const profile2 = await scoreRoute(client, {
      settler: TARGET,
      protocolSlug: "demo",
      fetchFn: failing as unknown as typeof fetch,
    });
    expect(profile2.tier).toBe(4);
    expect(profile2.signals.filter((s) => !s.ok).length).toBeGreaterThan(0);
  });

  it("every signal carries provenance", async () => {
    const client = makeClient({
      eth_getStorageAt: () => zeroSlot,
      eth_blockNumber: () => "0x10",
      eth_getLogs: () => [],
    });
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ tvl: 50_000_000, tvlPrevMonth: 51_000_000 }) });
    const profile = await scoreRoute(client, {
      settler: TARGET,
      protocolSlug: "demo",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    for (const s of profile.signals) {
      expect(s.source.detail.length).toBeGreaterThan(0);
      expect(s.observedAt).toBeGreaterThan(0);
    }
    const cards = provenanceCards(profile);
    expect(cards).toHaveLength(profile.signals.length);
    expect(cards.every((c) => c.query.length > 0)).toBe(true);
  });

  it("provenance includes block number for rpc signals", async () => {
    const client = makeClient({
      eth_getStorageAt: () => zeroSlot,
      eth_getCode: () => "0x6000",
      eth_blockNumber: () => "0x2a",
      eth_getLogs: () => [],
    });
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tvl: 50_000_000 }) });
    const profile = await scoreRoute(client, {
      settler: TARGET,
      protocolSlug: "demo",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const rpcSignal = profile.signals.find((s) => s.source.kind === "rpc");
    expect(rpcSignal?.blockNumber).toBe(42n);
  });
});

describe("decodeSafeOwners", () => {
  it("decodes owner list", () => {
    const owners = Array.from({ length: 3 }, (_, i) => ADDR(i + 1).slice(2)).join("");
    const raw = `0x${(0x20).toString(16).padStart(64, "0")}${(3).toString(16).padStart(64, "0")}${owners}`;
    expect(decodeSafeOwners(raw as `0x${string}`)).toHaveLength(3);
  });

  it("returns null for garbage", () => {
    expect(decodeSafeOwners("0xdeadbeef")).toBe(null);
  });
});
