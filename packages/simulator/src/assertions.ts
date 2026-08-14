import { Address, parseAbi } from "viem";
import { SimulationAssertion } from "@intentguard/core";
import { AnvilFork, snapshotHelpers } from "./fork.js";

export interface AssertionContext {
  fork: AnvilFork;
  token: Address;
  destinationToken: Address;
  recipient: Address;
  from: Address;
  notionalTokens: bigint;
  expectedOutputTokens: bigint;
  quotedSlippageBps: number;
  /** The route's on-fork calls, executed after impersonating `from`. */
  executeRoute?: (ctx: AssertionContext) => Promise<void>;
}

const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address, uint256) returns (bool)",
  "function approve(address, uint256) returns (bool)",
  "function transferFrom(address, address, uint256) returns (bool)",
  "function allowance(address, address) view returns (uint256)",
]);

async function balanceOf(ctx: AssertionContext, token: Address, who: Address): Promise<bigint> {
  const res = await ctx.fork.client.call({ to: token, data: encodeBalanceOf(who) });
  return res.data ? BigInt(res.data) : 0n;
}

function encodeBalanceOf(who: Address): `0x${string}` {
  return `0x70a08231${who.slice(2).padStart(64, "0")}` as `0x${string}`;
}

function encodeTransfer(to: Address, amount: bigint): `0x${string}` {
  return `0xa9059cbb${to.slice(2).padStart(64, "0")}${amount.toString(16).padStart(64, "0")}` as `0x${string}`;
}

function encodeApprove(spender: Address, amount: bigint): `0x${string}` {
  return `0x095ea7b3${spender.slice(2).padStart(64, "0")}${amount.toString(16).padStart(64, "0")}` as `0x${string}`;
}

function encodeTransferFrom(from: Address, to: Address, amount: bigint): `0x${string}` {
  return `0x23b872dd${from.slice(2).padStart(64, "0")}${to.slice(2).padStart(64, "0")}${amount.toString(16).padStart(64, "0")}` as `0x${string}`;
}

async function impersonate(ctx: AssertionContext) {
  const h = snapshotHelpers(ctx.fork.client);
  await h.setBalance(ctx.from, 10n ** 18n);
  await h.impersonate(ctx.from);
}

/** Send a tx and return whether it executed successfully (receipt status 0x1). */
async function sendTx(client: AnvilFork["client"], tx: { from: Address; to: Address; data: `0x${string}` }): Promise<boolean> {
  const hash = (await client.request({
    method: "eth_sendTransaction",
    params: [tx],
  })) as string;
  let receipt: { status?: string } | null = null;
  for (let i = 0; i < 50 && !receipt; i++) {
    receipt = (await client.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    })) as { status?: string } | null;
    if (!receipt) await new Promise((r) => setTimeout(r, 100));
  }
  return receipt?.status === "0x1";
}

/** Run the balance-delta assertion: destination receives what the quote promised. */
export async function assertBalanceDelta(ctx: AssertionContext): Promise<SimulationAssertion> {
  try {
    const h = snapshotHelpers(ctx.fork.client);
    const snap = await h.snapshot();
    await impersonate(ctx);
    const before = await balanceOf(ctx, ctx.destinationToken, ctx.recipient);
    if (ctx.executeRoute) await ctx.executeRoute(ctx);
    const after = await balanceOf(ctx, ctx.destinationToken, ctx.recipient);
    await h.revert(snap);

    const delta = after - before;
    const passed = delta >= ctx.expectedOutputTokens;
    return {
      id: "balanceDelta",
      label: "Destination balance delta",
      passed,
      observed: `received ${delta} of promised ${ctx.expectedOutputTokens} (shortfall ${delta < ctx.expectedOutputTokens ? ctx.expectedOutputTokens - delta : 0n})`,
    };
  } catch (e) {
    return { id: "balanceDelta", label: "Destination balance delta", passed: false, observed: `simulation error: ${(e as Error).message}` };
  }
}

/** Fee-on-transfer check: send a known amount to a fresh address; received must equal sent. */
export async function assertFeeOnTransfer(ctx: AssertionContext): Promise<SimulationAssertion> {
  try {
    const h = snapshotHelpers(ctx.fork.client);
    const snap = await h.snapshot();
    await impersonate(ctx);
    const fresh = ("0x" + "feed".padStart(40, "0")) as Address;
    const sent = 100_000n;
    const before = await balanceOf(ctx, ctx.destinationToken, fresh);
    // transfer FROM the impersonated holder
    await ctx.fork.client.request({
      method: "eth_sendTransaction",
      params: [{ from: ctx.from, to: ctx.destinationToken, data: encodeTransfer(fresh, sent) }],
    });
    const after = await balanceOf(ctx, ctx.destinationToken, fresh);
    await h.revert(snap);
    const received = after - before;
    const passed = received === sent;
    return {
      id: "feeOnTransfer",
      label: "Fee-on-transfer / rebasing token",
      passed,
      observed: `sent ${sent}, received ${received}${passed ? "" : ` (shortfall ${sent - received})`}`,
    };
  } catch (e) {
    return { id: "feeOnTransfer", label: "Fee-on-transfer / rebasing token", passed: false, observed: `simulation error: ${(e as Error).message}` };
  }
}

/** Honeypot check: transfer in, then attempt to transfer out from the recipient. */
export async function assertHoneypot(ctx: AssertionContext): Promise<SimulationAssertion> {
  try {
    const h = snapshotHelpers(ctx.fork.client);
    const snap = await h.snapshot();
    await impersonate(ctx);
    const victim = ("0x" + "b0b".padStart(40, "0")) as Address;
    const amount = 10_000n;
    // Transfer in from the impersonated holder.
    const inboundOk = await sendTx(ctx.fork.client, { from: ctx.from, to: ctx.destinationToken, data: encodeTransfer(victim, amount) });
    // Now try to transfer out FROM the victim.
    await h.impersonate(victim);
    await h.setBalance(victim, 10n ** 18n);
    const outboundOk = await sendTx(ctx.fork.client, { from: victim, to: ctx.destinationToken, data: encodeTransfer(ctx.from, amount) });
    await h.revert(snap);
    const honeypot = inboundOk && !outboundOk;
    return {
      id: "honeypot",
      label: "Honeypot / blocklist behavior",
      passed: !honeypot,
      observed: honeypot
        ? "transfer IN succeeded, transfer OUT reverted — the token is a honeypot"
        : inboundOk && outboundOk
          ? "inbound and outbound transfers both succeeded"
          : `inbound transfer ${inboundOk ? "succeeded" : "failed"}, outbound ${outboundOk ? "succeeded" : "failed"}`,
    };
  } catch (e) {
    return { id: "honeypot", label: "Honeypot / blocklist behavior", passed: false, observed: `simulation error: ${(e as Error).message}` };
  }
}

/** Approval-scope check: unlimited allowance to an upgradeable proxy is flagged. */
export async function assertApprovalScope(ctx: AssertionContext & { spender: Address; spenderIsProxy: boolean }): Promise<SimulationAssertion> {
  try {
    const h = snapshotHelpers(ctx.fork.client);
    const snap = await h.snapshot();
    await impersonate(ctx);
    await ctx.fork.client.request({
      method: "eth_sendTransaction",
      params: [{ from: ctx.from, to: ctx.token, data: encodeApprove(ctx.spender, 2n ** 256n - 1n) }],
    });
    const allowRes = await ctx.fork.client.call({ to: ctx.token, data: `0xdd62ed3e${ctx.from.slice(2).padStart(64, "0")}${ctx.spender.slice(2).padStart(64, "0")}` });
    const allowance = allowRes.data ? BigInt(allowRes.data) : 0n;
    await h.revert(snap);
    const unlimited = allowance === 2n ** 256n - 1n;
    const passed = !(unlimited && ctx.spenderIsProxy);
    return {
      id: "approvalScope",
      label: "Approval scope",
      passed,
      observed: unlimited && ctx.spenderIsProxy
        ? "unlimited approval to an upgradeable contract — standing drain risk"
        : unlimited
          ? "unlimited approval to a non-proxy spender (noted)"
          : "bounded approval",
    };
  } catch (e) {
    return { id: "approvalScope", label: "Approval scope", passed: false, observed: `simulation error: ${(e as Error).message}` };
  }
}

/** Run every assertion in sequence; each starts from a clean snapshot. */
export async function runAssertions(
  fork: AnvilFork,
  base: AssertionContext,
  extra: { spender?: Address; spenderIsProxy?: boolean } = {},
): Promise<SimulationAssertion[]> {
  const ctx: AssertionContext & { spender: Address; spenderIsProxy: boolean } = {
    ...base,
    spender: extra.spender ?? base.destinationToken,
    spenderIsProxy: extra.spenderIsProxy ?? false,
  };
  return [
    await assertBalanceDelta(ctx),
    await assertFeeOnTransfer(ctx),
    await assertHoneypot(ctx),
    await assertApprovalScope(ctx),
  ];
}
