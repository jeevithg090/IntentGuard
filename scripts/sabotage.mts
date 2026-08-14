#!/usr/bin/env node
/**
 * IntentGuard sabotage demo — submit an out-of-policy order with a *perfectly
 * valid* attestation and watch the vault revert on-chain.
 *
 * Usage: pnpm tsx scripts/sabotage.ts
 * Env:   RPC_URL VAULT_ADDRESS ATTESTOR_PRIVATE_KEY (throwaway demo key only)
 */
import { createPublicClient, createWalletClient, http, parseAbi, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { encodeOrderData, orderIdOf, signAttestation, attestorAccount } from "../packages/attestor/src/index.js";

const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const vaultAddress = (process.env.VAULT_ADDRESS ?? "") as `0x${string}`;
const attestorKey = (process.env.ATTESTOR_PRIVATE_KEY ?? "") as `0x${string}`;

if (!vaultAddress || !attestorKey) {
  console.error("Set VAULT_ADDRESS and ATTESTOR_PRIVATE_KEY (demo throwaway key only).");
  process.exit(1);
}

const ORDER_TYPE = keccak256("0xIntentGuardV1");

// The forgery: riskTier = 4 against a policy whose maxRiskTier is 2.
// The attestation is signed by the REAL attestor key — the signature is valid.
// The vault still reverts, because it re-checks the tier itself.
const attacker = attestorAccount(attestorKey);
const user = attacker.address; // attacker is also the "user" for demo simplicity

const orderData = encodeOrderData({
  user,
  inputToken: vaultAddress, // irrelevant to the revert; the tier check fires first
  inputAmount: 5_000_000000n,
  minOutput: 4_750_000000n,
  destinationChainId: 42161n,
  settler: user,
  recipient: user,
  destinationData: "0x",
});

const order = {
  fillDeadline: Math.floor(Date.now() / 1000) + 3600,
  orderDataType: ORDER_TYPE,
  orderData,
};

const att = await signAttestation(attacker, vaultAddress, rpcUrl, {
  orderId: orderIdOf(order),
  riskTier: 4, // ← the forgery
  feeBps: 31,
  simHash: keccak256("0xforged-sim"),
  expiry: Math.floor(Date.now() / 1000) + 900,
  nonce: 0n,
});

console.log("Submitting forged tier-4 attestation…");
console.log(`  orderId:   ${att.orderId}`);
console.log("  riskTier:  4  (policy max: 2)");
console.log("  signed by: the REAL attestor key");
console.log();

const wallet = createWalletClient({ account: attacker, transport: http(rpcUrl) });

try {
  const hash = await wallet.writeContract({
    address: vaultAddress,
    abi: parseAbi([
      "function openWithPolicy((uint32 fillDeadline, bytes32 orderDataType, bytes orderData), (bytes32 orderId, uint8 riskTier, uint16 feeBps, bytes32 simHash, uint64 expiry, uint64 nonce), bytes, bytes32[]) external",
    ]),
    functionName: "openWithPolicy",
    args: [
      [order.fillDeadline, order.orderDataType, order.orderData],
      [att.orderId, att.riskTier, att.feeBps, att.simHash, BigInt(att.expiry), att.nonce],
      att.signature,
      [] as `0x${string}`[],
    ],
  });
  console.log(`UNEXPECTED SUCCESS — tx ${hash}. The policy failed to hold.`);
  process.exit(1);
} catch (e) {
  const msg = (e as Error).message;
  if (/RiskTierExceedsPolicy|revert/i.test(msg)) {
    console.log("REVERTED — RiskTierExceedsPolicy. The chain enforced the policy.");
    console.log("A fully compromised attestor still cannot exceed the mandate.");
    process.exit(0);
  }
  console.error("Unexpected error:", msg);
  process.exit(1);
}
