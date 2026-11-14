import { PublicClient, Address, parseAbi } from "viem";
import { Signal, RiskTier } from "@intentguard/core";

const SETTLER_ABI = parseAbi([
  "event OrderOpened(bytes32 indexed orderId, address indexed caller, address indexed settler, uint256 inputAmount, uint32 fillDeadline)",
  "event OrderFilled(bytes32 indexed orderId, uint256 filledAt, uint256 outputAmount)",
]);

const fail = (detail: string, url?: string): Signal => ({
  id: "solverHistory",
  label: "Solver track record",
  value: null,
  tierContribution: 4,
  source: { kind: "rpc", detail, url },
  observedAt: Date.now(),
  ok: false,
});

export interface SolverHistoryFacts {
  opens: number;
  fills: number;
  fillRate: number | null;
  medianLatencySeconds: number | null;
  tier: RiskTier;
}

export async function scoreSolverHistory(
  client: PublicClient,
  settler: Address,
  fromBlock: bigint = 0n,
): Promise<Signal> {
  const rpcUrl = (client as { transport?: { url?: string } }).transport?.url;
  try {
    const blockNumber = await client.getBlockNumber();
    const from = fromBlock > 0n ? fromBlock : blockNumber - 200_000n > 0n ? blockNumber - 200_000n : 0n;

    const [opens, fills] = await Promise.all([
      client.getLogs({
        address: settler,
        event: SETTLER_ABI[0],
        fromBlock: from,
        toBlock: blockNumber,
      }),
      client.getLogs({
        address: settler,
        event: SETTLER_ABI[1],
        fromBlock: from,
        toBlock: blockNumber,
      }),
    ]);

    const fillTimes = new Map<string, number>();
    for (const f of fills) fillTimes.set(f.args.orderId!, Number(f.args.filledAt));

    // Latency: open-event block timestamp → fill timestamp, for the first 50 opens.
    const openBlockTimes = await Promise.all(
      opens.slice(0, 50).map(async (o) => ({
        id: o.args.orderId!,
        t: Number((await client.getBlock({ blockNumber: o.blockNumber })).timestamp),
      })),
    );
    const latencies = openBlockTimes
      .filter(({ id }) => fillTimes.has(id))
      .map(({ id, t }) => Math.max(0, fillTimes.get(id)! - t))
      .sort((a, b) => a - b);

    const median = latencies.length > 0 ? latencies[Math.floor(latencies.length / 2)] : null;
    const fillRate = opens.length > 0 ? fills.length / opens.length : null;

    let tier: RiskTier = 1;
    if (fillRate !== null && fillRate < 0.8) tier = 4;
    else if (median !== null && median > 3600) tier = 3;
    else if (fillRate !== null && fillRate < 0.95) tier = 2;

    const facts: SolverHistoryFacts = {
      opens: opens.length,
      fills: fills.length,
      fillRate,
      medianLatencySeconds: median,
      tier,
    };
    return {
      id: "solverHistory",
      label: "Solver track record",
      value: JSON.stringify(facts),
      tierContribution: tier,
      source: {
        kind: "rpc",
        detail: `eth_getLogs(OrderOpened/OrderFilled @ ${settler}, blocks ${from}–${blockNumber}) → ${opens.length} opens, ${fills.length} fills, fill rate ${fillRate === null ? "n/a" : (fillRate * 100).toFixed(1)}%, median latency ${median === null ? "n/a" : median + "s"}`,
        url: rpcUrl,
      },
      observedAt: Date.now(),
      blockNumber,
      ok: true,
    };
  } catch (e) {
    return fail(`solver history read failed: ${(e as Error).message}`, rpcUrl);
  }
}
