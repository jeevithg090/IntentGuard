#!/usr/bin/env node
/**
 * IntentGuard sabotage demo — submit an out-of-policy order with a *perfectly
 * valid* attestation and watch the vault revert on-chain.
 *
 * Usage: pnpm sabotage
 * Env:   RPC_URL VAULT_ADDRESS ATTESTOR_PRIVATE_KEY (throwaway demo key only)
 *
 * The attestor key must be the vault's configured attestor. For simplicity the
 * same account also acts as the vault user: if it has no committed policy yet,
 * the script commits the demo policy (max risk tier 2) first.
 */
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseAbi,
  toHex,
} from "viem";
import { encodeOrderData, orderIdOf, signAttestation, attestorAccount } from "../packages/attestor/src/index.js";

const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const vaultAddress = (process.env.VAULT_ADDRESS ?? "") as `0x${string}`;
const attestorKey = (process.env.ATTESTOR_PRIVATE_KEY ?? "") as `0x${string}`;

if (!/^0x[0-9a-fA-F]{40}$/.test(vaultAddress) || !/^0x[0-9a-fA-F]{64}$/.test(attestorKey)) {
  console.error("Set VAULT_ADDRESS and ATTESTOR_PRIVATE_KEY (demo throwaway key only).");
  process.exit(1);
}

const VAULT_ABI = parseAbi([
  "function token() view returns (address)",
  "function attestor() view returns (address)",
  "function policyOf(address) view returns ((uint8 maxRiskTier, uint16 maxFeeBps, uint256 maxNotionalPerTx, uint256 dailyBudget, uint32 minFillDeadline, bytes32 allowedSettlersRoot, uint64 expiry))",
  "function setPolicy((uint8 maxRiskTier, uint16 maxFeeBps, uint256 maxNotionalPerTx, uint256 dailyBudget, uint32 minFillDeadline, bytes32 allowedSettlersRoot, uint64 expiry)) external",
  "function openWithPolicy((uint32 fillDeadline, bytes32 orderDataType, bytes orderData), (bytes32 orderId, uint8 riskTier, uint16 feeBps, bytes32 simHash, uint64 expiry, uint64 nonce), bytes, bytes32[]) external",
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
]);

const ORDER_TYPE = keccak256(toHex("IntentGuardV1"));

const attacker = attestorAccount(attestorKey);
const user = attacker.address; // attacker is also the "user" for demo simplicity
const publicClient = createPublicClient({ transport: http(rpcUrl) });
const wallet = createWalletClient({ account: attacker, transport: http(rpcUrl) });

const [token, configuredAttestor, policy] = await Promise.all([
  publicClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: "token" }),
  publicClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: "attestor" }),
  publicClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: "policyOf", args: [user] }),
]);

if (configuredAttestor.toLowerCase() !== user.toLowerCase()) {
  console.error(`ATTESTOR_PRIVATE_KEY controls ${user}, but the vault's attestor is ${configuredAttestor}.`);
  process.exit(1);
}

if (policy.expiry <= BigInt(Math.floor(Date.now() / 1000))) {
  console.log("No active policy for the demo user — committing the demo policy (max risk tier 2)…");
  const hash = await wallet.writeContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: "setPolicy",
    chain: null,
    args: [
      {
        maxRiskTier: 2,
        maxFeeBps: 50,
        maxNotionalPerTx: 10_000_000000n,
        dailyBudget: 25_000_000000n,
        minFillDeadline: 1800,
        allowedSettlersRoot: keccak256(user),
        expiry: BigInt(Math.floor(Date.now() / 1000) + 365 * 86400),
      },
    ],
  });
  await publicClient.waitForTransactionReceipt({ hash });
}

// The forgery: riskTier = 4 against a policy whose maxRiskTier is 2.
// The attestation is signed by the REAL attestor key — the signature is valid.
// The vault still reverts, because it re-checks the tier itself.
const order = {
  fillDeadline: Math.floor(Date.now() / 1000) + 3600,
  orderDataType: ORDER_TYPE,
  orderData: encodeOrderData({
    user,
    inputToken: token,
    inputAmount: 5_000_000000n,
    minOutput: 4_750_000000n,
    destinationChainId: 42161n,
    settler: user,
    recipient: user,
    destinationData: "0x",
  }),
};

const att = await signAttestation(attacker, vaultAddress, rpcUrl, {
  orderId: orderIdOf(order),
  riskTier: 4, // ← the forgery
  feeBps: 31,
  simHash: keccak256(toHex("forged-sim")),
  expiry: Math.floor(Date.now() / 1000) + 900,
  nonce: BigInt(Date.now()),
});

console.log("Submitting forged tier-4 attestation…");
console.log(`  orderId:   ${att.orderId}`);
console.log("  riskTier:  4  (policy max: 2)");
console.log("  signed by: the REAL attestor key");
console.log();

try {
  await publicClient.simulateContract({
    account: attacker,
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: "openWithPolicy",
    args: [order, { ...att, expiry: BigInt(att.expiry) }, att.signature, []],
  });
  console.log("UNEXPECTED SUCCESS — the vault accepted the order. The policy failed to hold.");
  process.exit(1);
} catch (e) {
  const revert = e instanceof BaseError ? e.walk((err) => err instanceof ContractFunctionRevertedError) : null;
  const name = revert instanceof ContractFunctionRevertedError ? revert.data?.errorName : undefined;
  if (name === "RiskTierExceedsPolicy") {
    console.log("REVERTED — RiskTierExceedsPolicy. The chain enforced the policy.");
    console.log("A fully compromised attestor still cannot exceed the mandate.");
    process.exit(0);
  }
  console.error(`Reverted for a different reason (${name ?? "unknown"}):`, (e as Error).message);
  process.exit(1);
}
