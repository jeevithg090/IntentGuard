import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "node:child_process";
import { execSync } from "node:child_process";
import { Address, createPublicClient, http, parseAbi } from "viem";
import app, { buildAttestation } from "../src/index.js";
import { orderIdOf } from "@intentguard/attestor";
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

let anvil: ChildProcess;

/** Deploy `src/<path>.sol:<Name>` from the contracts package, e.g. "mocks/MockUSDC". */
function deploy(contractPath: string, args: string[] = []): Address {
  const contract = contractPath.split("/").pop()!;
  const argStr = args.length > 0 ? ` --constructor-args ${args.join(" ")}` : "";
  const out = execSync(
    `cd ../contracts && forge create src/${contractPath}.sol:${contract} --rpc-url ${RPC} --private-key ${TEST_KEY} --broadcast${argStr}`,
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
    const res = await app.request(
      "/decide",
      {
        method: "POST",
        body: JSON.stringify({ mandate: "Move $5,000 USDC to the best safe yield opportunity" }),
        headers: { "content-type": "application/json" },
      },
      { BASE_SEPOLIA_RPC: RPC },
    );
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
    const res = await app.request(
      "/decide",
      {
        method: "POST",
        body: JSON.stringify({
          mandate: "max risk tier 1",
          quotes: [
            {
              ...quote,
              id: "h1",
              inputAmountUsd: 5000,
              expectedOutputTokens: quote.expectedOutputTokens.toString(),
              expectedOutputUsd: 5041,
            },
          ],
        }),
        headers: { "content-type": "application/json" },
      },
      { BASE_SEPOLIA_RPC: RPC },
    );
    const journal = await res.json();
    expect(journal.finalVerdict).toBe("REFUSE");
  }, 30_000);

  it("sabotage path: forged EXECUTE for tier-4 route", async () => {
    const res = await app.request(
      "/sabotage",
      {
        method: "POST",
        body: JSON.stringify({ routeId: "route-c", tier: 4 }),
        headers: { "content-type": "application/json" },
      },
      {},
    );
    expect(res.status).toBe(200);
    const forged = await res.json();
    expect(forged.intentId).toMatch(/^SABOTAGE-/);
    expect(forged.finalVerdict).toBe("EXECUTE");
    expect(forged.error).toContain("RiskTierExceedsPolicy");
  });

  it("signs an attestation the deployed vault attributes to the attestor", async () => {
    const usdc = deploy("mocks/MockUSDC");
    const vault = deploy("PolicyVault", [usdc, ATTESTOR_ADDR]);
    const sel = {
      ...DEMO_QUOTES[0],
      profile: { settler: DEMO_QUOTES[0].settler, tier: 2 as const, signals: [], rationale: [], computedAt: 0 },
    };
    const env = { BASE_SEPOLIA_RPC: RPC, ATTESTOR_PRIVATE_KEY: ATTESTOR_KEY, VAULT_ADDRESS: vault };
    const { order, attestation } = await buildAttestation(env, sel);
    expect(attestation.signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(attestation.riskTier).toBe(2);
    expect(attestation.orderId).toBe(orderIdOf(order));

    const client = createPublicClient({ transport: http(RPC) });
    const recovered = await client.readContract({
      address: vault,
      abi: parseAbi([
        "function recoverAttestor((bytes32 orderId,uint8 riskTier,uint16 feeBps,bytes32 simHash,uint64 expiry,uint64 nonce) att, bytes sig) view returns (address)",
      ]),
      functionName: "recoverAttestor",
      args: [{ ...attestation, expiry: BigInt(attestation.expiry) }, attestation.signature],
    });
    expect(recovered).toBe(ATTESTOR_ADDR);
  }, 60_000);

  it("returns an unsigned attestation when no attestor key is configured", async () => {
    const sel = {
      ...DEMO_QUOTES[0],
      profile: { settler: DEMO_QUOTES[0].settler, tier: 1 as const, signals: [], rationale: [], computedAt: 0 },
    };
    const { attestation } = await buildAttestation({}, sel);
    expect(attestation.signature).toBe("0x");
  });

  it("journal retrieval round trip", async () => {
    const res = await app.request(
      "/decide",
      { method: "POST", body: "{}", headers: { "content-type": "application/json" } },
      { BASE_SEPOLIA_RPC: RPC },
    );
    const journal = await res.json();
    const res2 = await app.request(`/journal/${journal.intentId}`, {}, {});
    expect(res2.status).toBe(200);
    expect((await res2.json()).intentId).toBe(journal.intentId);
  }, 30_000);
});

describe("API input handling (no chain required)", () => {
  const post = (path: string, body: unknown, env: Record<string, string> = {}) =>
    app.request(
      path,
      { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } },
      env,
    );

  it("rejects an invalid /decide body with 400 and issue details", async () => {
    const res = await post("/decide", { notionalUsd: "lots" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid request");
    expect(body.issues[0].path).toBe("notionalUsd");
  });

  it("rejects posted quotes with a malformed settler address", async () => {
    const res = await post("/decide", {
      quotes: [{ ...DEMO_QUOTES[0], expectedOutputTokens: "1", settler: "0xnope" }],
    });
    expect(res.status).toBe(400);
  });

  it("disables /sabotage in production", async () => {
    const res = await post("/sabotage", {}, { NODE_ENV: "production" });
    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown sabotage route and for unknown journals", async () => {
    expect((await post("/sabotage", { routeId: "route-z" })).status).toBe(404);
    expect((await app.request("/journal/INTENT-MISSING")).status).toBe(404);
    expect((await app.request("/no-such-path")).status).toBe(404);
  });

  it("rejects a non-address /provenance parameter", async () => {
    const res = await app.request("/provenance/not-an-address");
    expect(res.status).toBe(400);
  });

  it("lists journals newest first", async () => {
    const a = await (await post("/sabotage", { routeId: "route-a", tier: 3 })).json();
    const b = await (await post("/sabotage", { routeId: "route-b", tier: 4 })).json();
    expect(a.intentId).not.toBe(b.intentId);
    const list = await (await app.request("/journals")).json();
    expect(list[0].intentId).toBe(b.intentId);
  });

  it("sends CORS headers only for configured origins", async () => {
    const env = { CORS_ORIGINS: "https://app.example" };
    const allowed = await app.request("/health", { headers: { origin: "https://app.example" } }, env);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://app.example");
    const none = await app.request("/health", { headers: { origin: "https://app.example" } }, {});
    expect(none.headers.get("access-control-allow-origin")).toBeNull();
  });
});
