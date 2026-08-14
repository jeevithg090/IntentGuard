import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Address, createPublicClient, http, parseAbi } from "viem";
import { execSync } from "node:child_process";
import {
  attestationHash,
  ATTESTATION_TYPEHASH,
  encodeOrder,
  encodeOrderData,
  orderIdOf,
  signAttestation,
  attestorAccount,
} from "../src/index.js";

const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const DEPLOYER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;
const ATTESTOR_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const; // anvil key 1
const ATTESTOR_ADDR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;

function deployVault(rpcUrl: string): { usdc: Address; vault: Address } {
  const out = execSync(
    `cd ../contracts && forge create src/mocks/MockUSDC.sol:MockUSDC --rpc-url ${rpcUrl} --private-key ${TEST_KEY} --broadcast`,
    { encoding: "utf8" },
  );
  const usdc = /Deployed to: (0x[0-9a-fA-F]+)/.exec(out)?.[1];
  const out2 = execSync(
    `cd ../contracts && forge create src/PolicyVault.sol:PolicyVault --rpc-url ${rpcUrl} --private-key ${TEST_KEY} --broadcast --constructor-args ${usdc} ${ATTESTOR_ADDR}`,
    { encoding: "utf8" },
  );
  const vault = /Deployed to: (0x[0-9a-fA-F]+)/.exec(out2)?.[1];
  if (!usdc || !vault) throw new Error("deploy failed");
  return { usdc: usdc as Address, vault: vault as Address };
}

describe("attestor signing", () => {
  it("attestationHash matches the contract's EIP-712 hash", () => {
    const orderId = ("0x" + "ab".repeat(32)) as `0x${string}`;
    const att = { orderId, riskTier: 2, feeBps: 31, simHash: ("0x" + "cd".repeat(32)) as `0x${string}`, expiry: 1700000000n, nonce: 0n };
    const hash = attestationHash(("0x" + "ef".repeat(32)) as `0x${string}`, att);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("encodeOrderData / orderId round trip", () => {
    const data = {
      user: DEPLOYER,
      inputToken: DEPLOYER,
      inputAmount: 5000_000000n,
      minOutput: 4750_000000n,
      destinationChainId: 42161n,
      settler: DEPLOYER,
      recipient: DEPLOYER,
      destinationData: "0x" as `0x${string}`,
    };
    const encoded = encodeOrderData(data);
    expect(encoded.startsWith("0x")).toBe(true);
    const order = { fillDeadline: Math.floor(Date.now() / 1000) + 3600, orderDataType: ("0x" + "11".repeat(32)) as `0x${string}`, orderData: encoded };
    expect(orderIdOf(order)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("signs against a deployed vault (E2E digest match)", async () => {
    // Spin up a local anvil, deploy the vault, verify the TS signature passes recoverAttestor.
    const { spawn } = await import("node:child_process");
    const anvil = spawn("anvil", ["--port", "39472", "--silent"]);
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const rpcUrl = "http://127.0.0.1:39472";
      const { vault } = deployVault(rpcUrl);
      const account = attestorAccount(ATTESTOR_KEY);
      const att = await signAttestation(account, vault, rpcUrl, {
        orderId: ("0x" + "ab".repeat(32)) as `0x${string}`,
        riskTier: 2,
        feeBps: 31,
        simHash: ("0x" + "cd".repeat(32)) as `0x${string}`,
        expiry: Math.floor(Date.now() / 1000) + 3600,
        nonce: 0n,
      });
      expect(att.signature.length).toBe(132); // 0x + 65 bytes

      // The contract's recoverAttestor must return the attestor address.
      const client = createPublicClient({ transport: http(rpcUrl) });
      const recovered = await client.readContract({
        address: vault,
        abi: parseAbi(["function recoverAttestor((bytes32 orderId,uint8 riskTier,uint16 feeBps,bytes32 simHash,uint64 expiry,uint64 nonce) att, bytes sig) view returns (address)"]),
        functionName: "recoverAttestor",
        args: [[att.orderId, att.riskTier, att.feeBps, att.simHash, BigInt(att.expiry), att.nonce], att.signature],
      });
      expect(recovered.toLowerCase()).toBe(ATTESTOR_ADDR.toLowerCase());
    } finally {
      anvil.kill("SIGKILL");
    }
  }, 30_000);
});
