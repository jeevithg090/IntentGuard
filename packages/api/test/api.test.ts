import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "node:child_process";
import { execSync } from "node:child_process";
import { Address, createPublicClient, http, parseAbi } from "viem";
import app from "../src/index.js";
import { DEMO_QUOTES } from "../src/demoQuotes.js";

/**
 * E2E flows against a local anvil + deployed test vault. The full stack:
 * mandate → score → review (offline fallback) → simulate → attest → openWithPolicy.
 */

const ANVIL_PORT = 39475;
const RPC = `http://127.0.0.1:${ANVIL_PORT}`;
const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ATTESTOR_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ATTESTOR_ADDR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const DEMO_USER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

let anvil: ChildProcess;

function deploy(contract: string, args: string[] = []): Address {
  const argStr = args.length > 0 ? ` --constructor-args ${args.join(" ")}` : "";
  const out = execSync(
    `cd ../contracts && forge create src/${contract}.sol:${contract} --rpc-url ${RPC} --private-key ${TEST_KEY} --broadcast${argStr}`,
    { encoding: "utf8" },
  );
  const addr = /Deployed to: (0x[0-9a-fA-F]+)/.exec(out)?.[1];
  if (!addr) throw new Error(`deploy ${contract} failed`);
  return addr as Address;
}

describe("API flows (local anvil + deployed vault)", () => {
  beforeAll(async () => {
    anvil = spawn("anvil", ["--port", String(ANVIL_PORT), "--silent"]);
    await new Promise((r) => setTimeout(r, 1500));
  }, 30_000);

  afterAll(() => {
    anvil?.kill("SIGKILL");
  });

  it("GET /health", async () => {
    const res = await app.request("/health", {}, { BASE_SEPOLIA_RPC: RPC });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("happy path: decide → journal complete", async () => {
    const res = await app.request("/decide", { method: "POST", body: JSON.stringify({ mandate: "Move $5,000 USDC to the best safe yield opportunity" }), headers: { "content-type": "application/json" } }, { BASE_SEPOLIA_RPC: RPC });
    expect(res.status).toBe(200);
    const journal = await res.json();
    expect(journal.intentId).toMatch(/^INTENT-/);
    expect(journal.quotesEvaluated).toBe(3);
    expect(journal.profiles).toHaveLength(3);
    expect(journal.proposer).not.toBeNull();
    expect(journal.redTeam).not.toBeNull();
    expect(journal.arbiter).not.toBeNull();
    expect(journal.completedAt).not.toBeNull();
  }, 30_000);

  it("policy refusal path: all quotes above tier → REFUSE, no transaction", async () => {
    const quote = DEMO_QUOTES[0];
    const res = await app.request("/decide", {
      method: "POST",
      body: JSON.stringify({
        mandate: "max risk tier 1",
        quotes: [{ ...quote, id: "h1", inputAmountUsd: 5000, expectedOutputTokens: quote.expectedOutputTokens.toString(), expectedOutputUsd: 5041 }],
      }),
      headers: { "content-type": "application/json" },
    }, { BASE_SEPOLIA_RPC: RPC });
    const journal = await res.json();
    expect(journal.finalVerdict).toBe("REFUSE");
  }, 30_000);

  it("sabotage path: forged EXECUTE for tier-4 route", async () => {
    const res = await app.request("/sabotage", {
      method: "POST",
      body: JSON.stringify({ routeId: "route-c", tier: 4 }),
      headers: { "content-type": "application/json" },
    }, {});
    expect(res.status).toBe(200);
    const forged = await res.json();
    expect(forged.intentId).toMatch(/^SABOTAGE-/);
    expect(forged.finalVerdict).toBe("EXECUTE");
    expect(forged.error).toContain("RiskTierExceedsPolicy");
  });

  it("journal retrieval round trip", async () => {
    const res = await app.request("/decide", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }, { BASE_SEPOLIA_RPC: RPC });
    const journal = await res.json();
    const res2 = await app.request(`/journal/${journal.intentId}`, {}, {});
    expect(res2.status).toBe(200);
    expect((await res2.json()).intentId).toBe(journal.intentId);
  }, 30_000);
});
