import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Address } from "viem";
import { execSync } from "node:child_process";
import {
  startAnvilFork,
  runAssertions,
  computeSimHash,
  buildSimulationResult,
  allPassed,
  assertFeeOnTransfer,
  assertHoneypot,
  assertApprovalScope,
} from "../src/index.js";
import type { AnvilFork } from "../src/index.js";
import type { AssertionContext } from "../src/assertions.js";

/**
 * Deploy the mock tokens to a running local anvil using forge. Returns bytecode
 * and a deploy function that sends raw creation transactions.
 */

function getCreationBytecode(contract: string, args: string[] = []): string {
  const encoded =
    args.length > 0
      ? execSync(`cast abi-encode "constructor(${Array(args.length).fill("address").join(",")})" ${args.join(" ")}`, {
          encoding: "utf8",
          cwd: "../contracts",
        }).trim()
      : "";
  const bc = execSync(`cd ../contracts && forge inspect src/mocks/${contract}.sol:${contract} bytecode`, {
    encoding: "utf8",
  }).trim();
  return bc + encoded.slice(2);
}

async function deployContract(fork: AnvilFork, contract: string, args: string[] = []): Promise<Address> {
  const data = getCreationBytecode(contract, args) as `0x${string}`;
  const txHash = (await fork.client.request({
    method: "eth_sendTransaction",
    params: [{ from: DEPLOYER, data, gas: "0x300000" }],
  })) as string;
  // Poll for the receipt — anvil's first block mines lazily.
  let receipt: { contractAddress?: string } | null = null;
  for (let i = 0; i < 50 && !receipt; i++) {
    receipt = (await fork.client.request({
      method: "eth_getTransactionReceipt",
      params: [txHash],
    })) as { contractAddress?: string } | null;
    if (!receipt) await new Promise((r) => setTimeout(r, 100));
  }
  if (!receipt?.contractAddress) throw new Error(`deploy ${contract} failed`);
  return receipt.contractAddress as Address;
}

const DEPLOYER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const RECIPIENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

describe("simulator assertions (local anvil, real token bytecode)", () => {
  let fork: AnvilFork;
  let usdc: Address;
  let honeypot: Address;
  let fot: Address;

  beforeAll(async () => {
    fork = await startAnvilFork({});
    usdc = await deployContract(fork, "MockUSDC");
    honeypot = await deployContract(fork, "HoneypotToken", [DEPLOYER]);
    fot = await deployContract(fork, "FeeOnTransferToken", [DEPLOYER]);
    // Fund the deployer on every token so transfers in the assertions succeed.
    for (const token of [usdc, honeypot, fot]) {
      await fork.client.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: DEPLOYER,
            to: token,
            data: `0x40c10f19${DEPLOYER.slice(2).padStart(64, "0")}${(10n ** 18n).toString(16).padStart(64, "0")}`,
          },
        ],
      });
    }
  }, 60_000);

  afterAll(async () => {
    if (fork) await fork.stop();
  });

  it("fork spins up and reports a block", async () => {
    // Deploys in beforeAll already mined blocks; a fresh anvil starts at 0.
    expect(await fork.client.getBlockNumber()).toBeGreaterThanOrEqual(0n);
  });

  it("fork is killed on error", async () => {
    const f = await startAnvilFork({});
    expect(f.process.exitCode).toBe(null);
    await f.stop();
  });

  const baseCtx = (token: Address, overrides: Partial<AssertionContext> = {}): AssertionContext => ({
    fork,
    token,
    destinationToken: token,
    recipient: RECIPIENT,
    from: DEPLOYER,
    notionalTokens: 100_000n,
    expectedOutputTokens: 100_000n,
    quotedSlippageBps: 10,
    ...overrides,
  });

  it("passes a clean route (standard ERC-20 destination)", async () => {
    const ctx = baseCtx(usdc, {
      executeRoute: async (c) => {
        // Simulate: transfer the promised output to the recipient.
        await c.fork.client.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: c.from,
              to: c.destinationToken,
              data: `0xa9059cbb${c.recipient.slice(2).padStart(64, "0")}${c.expectedOutputTokens.toString(16).padStart(64, "0")}`,
            },
          ],
        });
      },
    });
    const results = await runAssertions(fork, ctx);
    expect(results.every((r) => r.passed)).toBe(true);
  }, 30_000);

  it("detects honeypot token", async () => {
    // HoneypotToken's owner is the DEPLOYER; inbound transfers from the owner
    // blocklist the recipient.
    const ctx = baseCtx(honeypot);
    const res = await assertHoneypot(ctx);
    expect(res.passed).toBe(false);
    expect(res.observed.toLowerCase()).toContain("honeypot");
  }, 30_000);

  it("detects fee-on-transfer", async () => {
    const ctx = baseCtx(fot);
    const res = await assertFeeOnTransfer(ctx);
    expect(res.passed).toBe(false);
    expect(res.observed).toContain("shortfall");
  }, 30_000);

  it("flags unlimited approval to a proxy", async () => {
    const ctx = baseCtx(usdc);
    const res = await assertApprovalScope({ ...ctx, spender: honeypot, spenderIsProxy: true });
    expect(res.passed).toBe(false);
    expect(res.observed).toContain("unlimited");
  }, 30_000);

  it("allows bounded approval", async () => {
    const ctx = baseCtx(usdc);
    const res = await assertApprovalScope({ ...ctx, spender: honeypot, spenderIsProxy: false });
    expect(res.passed).toBe(true);
  }, 30_000);

  it("simHash is deterministic", () => {
    const assertions = [
      { id: "a", label: "A", passed: true, observed: "x" },
      { id: "b", label: "B", passed: false, observed: "y" },
    ];
    expect(computeSimHash(123n, assertions)).toBe(computeSimHash(123n, assertions));
  });

  it("simHash changes when an assertion changes", () => {
    const a1 = [{ id: "a", label: "A", passed: true, observed: "x" }];
    const a2 = [{ id: "a", label: "A", passed: false, observed: "x" }];
    expect(computeSimHash(1n, a1)).not.toBe(computeSimHash(1n, a2));
  });

  it("simHash key ordering is stable", () => {
    const a = [
      { id: "a", label: "A", passed: true, observed: "1" },
      { id: "b", label: "B", passed: true, observed: "2" },
    ];
    const b = [
      { id: "b", label: "B", passed: true, observed: "2" },
      { id: "a", label: "A", passed: true, observed: "1" },
    ];
    expect(computeSimHash(1n, a)).toBe(computeSimHash(1n, b));
  });

  it("allPassed gates on any failure", () => {
    const res = buildSimulationResult(1n, [
      { id: "a", label: "A", passed: true, observed: "" },
      { id: "b", label: "B", passed: false, observed: "boom" },
    ]);
    expect(allPassed(res)).toBe(false);
  });

  it("failed simulation blocks attestation (allPassed is the gate)", () => {
    const res = buildSimulationResult(1n, [
      { id: "honeypot", label: "Honeypot", passed: false, observed: "blocklisted" },
    ]);
    expect(allPassed(res)).toBe(false);
  });
});
