import { Address, createPublicClient, createWalletClient, http, parseAbi, defineChain } from "viem";
import { Position, DriftEvent } from "@intentguard/core";
import { scanPositions, ScoreFn } from "./drift.js";

const VAULT_ABI = parseAbi([
  "function pause() external",
  "function unpause() external",
  "function paused() view returns (bool)",
]);

const localChain = defineChain({
  id: 31337,
  name: "Anvil Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [] } },
});

/**
 * Feature 5's kill switch: when the drift monitor escalates, call vault.pause().
 * All autonomous action halts until a human (the owner) unpauses.
 */
export async function escalateToVault(opts: {
  positions: Position[];
  score: ScoreFn;
  vaultAddress: Address;
  rpcUrl: string;
  pauserKey: `0x${string}`;
}): Promise<{ driftEvents: DriftEvent[]; paused: boolean; errors: string[] }> {
  const { driftEvents, escalations, errors } = await scanPositions(opts.positions, opts.score);
  if (escalations.length === 0) {
    return { driftEvents, paused: false, errors };
  }

  const account = (await import("viem/accounts")).privateKeyToAccount(opts.pauserKey);
  const wallet = createWalletClient({
    account,
    transport: http(opts.rpcUrl),
    chain: localChain,
  });

  await wallet.writeContract({
    address: opts.vaultAddress,
    abi: VAULT_ABI,
    functionName: "pause",
  } as never);

  const publicClient = createPublicClient({ transport: http(opts.rpcUrl), chain: localChain });
  const paused = (await publicClient.readContract({
    address: opts.vaultAddress,
    abi: VAULT_ABI,
    functionName: "paused",
  })) as boolean;

  return { driftEvents, paused, errors };
}

export { scanPositions, diffSignals } from "./drift.js";
export type { ScoreFn, ScanResult } from "./drift.js";
