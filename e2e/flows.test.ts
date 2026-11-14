import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess, execSync } from "node:child_process";
import { Address, createPublicClient, createWalletClient, http, parseAbi, encodePacked, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { encodeOrderData, orderIdOf, signAttestation, attestorAccount } from "../packages/attestor/src/index.js";
import app from "../packages/api/src/index.js";
import { DEMO_QUOTES } from "../packages/api/src/demoQuotes.js";

/**
 * End-to-end flows against a local Anvil and a deployed test vault. The sabotage flows submit real transactions and assert the vault
 * reverts RiskTierExceedsPolicy — the pitch.
 */

const ANVIL_PORT = 39476;
const RPC = `http://127.0.0.1:${ANVIL_PORT}`;
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ATTESTOR_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ATTESTOR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const USER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const USER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

const VAULT_ABI = parseAbi([
  "function setPolicy((uint8 maxRiskTier, uint16 maxFeeBps, uint256 maxNotionalPerTx, uint256 dailyBudget, uint32 minFillDeadline, bytes32 allowedSettlersRoot, uint64 expiry)) external",
  "function openWithPolicy((uint32 fillDeadline, bytes32 orderDataType, bytes orderData), (bytes32 orderId, uint8 riskTier, uint16 feeBps, bytes32 simHash, uint64 expiry, uint64 nonce), bytes, bytes32[]) external",
  "function paused() view returns (bool)",
  "function pause() external",
  "function deposits(address) view returns (uint256)",
  "function deposit(uint256) external",
  "function policyOf(address) view returns ((uint8, uint16, uint256, uint256, uint32, bytes32, uint64))",
  "function spentToday(address) view returns (uint256)",
  "error Unauthorized()",
  "error Paused()",
  "error StaleAttestation()",
  "error AttestationReplayed()",
  "error BadAttestor()",
  "error AttestationOrderMismatch()",
  "error RiskTierExceedsPolicy(uint8 attestationTier, uint8 policyTier)",
  "error FeeExceedsPolicy(uint16 attestationFeeBps, uint16 policyFeeBps)",
  "error NotionalExceedsPolicy(uint256 notional, uint256 policyMax)",
  "error FillDeadlineTooShort(uint32 fillDeadline, uint32 minRequired)",
  "error SettlerNotAllowed(address settler)",
  "error DailyBudgetExhausted(uint256 wouldSpend, uint256 remaining)",
  "error PolicyExpired()",
  "error BadOrderData()",
  "error InsufficientDeposit(uint256 requested, uint256 deposited)",
  "error DepositsPaused()",
]);

const ERC20_ABI = parseAbi([
  "function mint(address, uint256) external",
  "function approve(address, uint256) external",
  "function balanceOf(address) view returns (uint256)",
]);

let anvil: ChildProcess;
let usdc: Address;
let settler: Address;
let vault: Address;
let allowedRoot: `0x${string}`;
const ORDER_TYPE = keccak256(toHex("IntentGuardV1"));

/** Must match PolicyVault: keccak256(abi.encodePacked(settler)). */
function leafOf(a: Address): `0x${string}` {
  return keccak256(encodePacked(["address"], [a]));
}

let nextNonce = 0n;

function deploy(contractPath: string, args: string[] = []): Address {
  const argStr = args.length > 0 ? ` --constructor-args ${args.join(" ")}` : "";
  const out = execSync(
    `cd packages/contracts && forge create ${contractPath} --rpc-url ${RPC} --private-key ${DEPLOYER_KEY} --broadcast${argStr}`,
    { encoding: "utf8" },
  );
  const addr = /Deployed to: (0x[0-9a-fA-F]+)/.exec(out)?.[1];
  if (!addr) throw new Error(`deploy ${contractPath} failed`);
  return addr as Address;
}

const publicClient = createPublicClient({ transport: http(RPC) });
const deployerWallet = createWalletClient({ account: privateKeyToAccount(DEPLOYER_KEY), transport: http(RPC) });
const userWallet = createWalletClient({ account: privateKeyToAccount(USER_KEY), transport: http(RPC) });

async function setupVault() {
  usdc = deploy("src/mocks/MockUSDC.sol:MockUSDC");
  settler = deploy("src/mocks/MockOriginSettler.sol:MockOriginSettler", [usdc]);
  vault = deploy("src/PolicyVault.sol:PolicyVault", [usdc, ATTESTOR]);
  allowedRoot = leafOf(settler);

  // Demo policy: tier 2, fee 50bps, $10k/tx, $25k/day, 30min deadline.
  await deployerWallet.writeContract({
    address: usdc,
    abi: ERC20_ABI,
    functionName: "mint",
    args: [USER, 1_000_000_000000n],
  });

  await userWallet.writeContract({
    address: usdc,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [vault, 2n ** 256n - 1n],
  });

  const policy = {
    maxRiskTier: 2,
    maxFeeBps: 50,
    maxNotionalPerTx: 10_000_000000n,
    dailyBudget: 25_000_000000n,
    minFillDeadline: 1800,
    allowedSettlersRoot: allowedRoot,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 365 * 86400),
  };
  await userWallet.writeContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: "setPolicy",
    args: [
      [
        policy.maxRiskTier,
        policy.maxFeeBps,
        policy.maxNotionalPerTx,
        policy.dailyBudget,
        policy.minFillDeadline,
        policy.allowedSettlersRoot,
        policy.expiry,
      ],
    ],
  });

  await userWallet.writeContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: "deposit",
    args: [100_000_000000n],
  });
}

async function submitOrder(
  routeId: string,
  attestationTier: 1 | 2 | 3 | 4,
  opts: { inputAmount?: bigint } = {},
): Promise<{ hash: `0x${string}`; reverted: boolean; reason?: string }> {
  const quote = DEMO_QUOTES.find((q) => q.id === routeId)!;
  const orderData = encodeOrderData({
    user: USER,
    inputToken: usdc,
    inputAmount: opts.inputAmount ?? BigInt(Math.floor(quote.inputAmountUsd * 1e6)),
    minOutput: quote.expectedOutputTokens,
    destinationChainId: BigInt(quote.destinationChainId),
    settler,
    recipient: USER,
    destinationData: "0x",
  });
  const order = {
    fillDeadline: Math.floor(Date.now() / 1000) + 3600,
    orderDataType: ORDER_TYPE,
    orderData,
  };

  const att = await signAttestation(attestorAccount(ATTESTOR_KEY), vault, RPC, {
    orderId: orderIdOf(order),
    riskTier: attestationTier,
    feeBps: quote.feeBps,
    simHash: keccak256(toHex("sim")),
    expiry: Math.floor(Date.now() / 1000) + 900,
    nonce: nextNonce++,
  });

  const proof: `0x${string}`[] = [];

  try {
    const hash = await userWallet.writeContract({
      address: vault,
      abi: VAULT_ABI,
      functionName: "openWithPolicy",
      args: [
        [order.fillDeadline, order.orderDataType, order.orderData],
        [att.orderId, att.riskTier, att.feeBps, att.simHash, BigInt(att.expiry), att.nonce],
        att.signature,
        proof,
      ],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return { hash, reverted: receipt.status !== "success" };
  } catch (e) {
    return { hash: "0x" as `0x${string}`, reverted: true, reason: (e as Error).message };
  }
}

describe("E2E flows (local anvil + deployed vault)", () => {
  beforeAll(async () => {
    anvil = spawn("anvil", ["--port", String(ANVIL_PORT), "--silent"]);
    await new Promise((r) => setTimeout(r, 1500));
    await setupVault();
  }, 60_000);

  afterAll(() => {
    anvil?.kill("SIGKILL");
  });

  const SETTLER_ABI = parseAbi(["function opens() view returns (uint256)"]);
  const opens = () => publicClient.readContract({ address: settler, abi: SETTLER_ABI, functionName: "opens" });

  it("API pipeline — mandate → score → review → journal", async () => {
    const res = await app.request(
      "/decide",
      {
        method: "POST",
        body: JSON.stringify({ mandate: "Move $5,000 USDC safely" }),
        headers: { "content-type": "application/json" },
      },
      { BASE_SEPOLIA_RPC: RPC },
    );
    expect(res.status).toBe(200);
    const journal = await res.json();
    expect(journal.intentId).toMatch(/^INTENT-/);
    expect(journal.quotesEvaluated).toBe(3);
    expect(journal.profiles).toHaveLength(3);
    expect(journal.completedAt).not.toBeNull();
    // The API never submits transactions itself.
    expect(journal.txHash).toBeNull();
  }, 60_000);

  it("injection path — poisoned solver metadata is screened and logged", async () => {
    const res = await app.request(
      "/decide",
      { method: "POST", body: JSON.stringify({ mandate: "test" }), headers: { "content-type": "application/json" } },
      { BASE_SEPOLIA_RPC: RPC },
    );
    const journal = await res.json();
    expect(journal.injectionAttempts).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "route-c.annotations" })]),
    );
  }, 60_000);

  it("in-policy order with a valid attestation opens on-chain", async () => {
    const before = await opens();
    const res = await submitOrder("route-a", 2);
    expect(res.reverted).toBe(false);
    expect(await opens()).toBe(before + 1n);
    expect(
      await publicClient.readContract({ address: vault, abi: VAULT_ABI, functionName: "spentToday", args: [USER] }),
    ).toBe(5_000_000000n);
  }, 60_000);

  it("sabotage — attestor-signed tier-4 attestation still reverts RiskTierExceedsPolicy", async () => {
    // The signature is valid (real attestor key); the policy is not. The vault re-checks and reverts.
    const before = await opens();
    const res = await submitOrder("route-c", 4);
    expect(res.reverted).toBe(true);
    expect(res.reason).toMatch(/RiskTierExceedsPolicy/);
    expect(await opens()).toBe(before);
  }, 60_000);

  it("notional above the per-transaction limit reverts NotionalExceedsPolicy", async () => {
    const res = await submitOrder("route-a", 2, { inputAmount: 20_000_000000n });
    expect(res.reverted).toBe(true);
    expect(res.reason).toMatch(/NotionalExceedsPolicy/);
  }, 60_000);

  it("drift kill switch — a paused vault rejects even in-policy orders", async () => {
    await deployerWallet.writeContract({ address: vault, abi: VAULT_ABI, functionName: "pause" });
    expect(await publicClient.readContract({ address: vault, abi: VAULT_ABI, functionName: "paused" })).toBe(true);

    const res = await submitOrder("route-a", 2);
    expect(res.reverted).toBe(true);
    expect(res.reason).toMatch(/Paused/);
  }, 60_000);
});
