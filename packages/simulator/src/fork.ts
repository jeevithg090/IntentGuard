import { spawn, ChildProcess } from "node:child_process";
import { Address, createPublicClient, createWalletClient, custom, http } from "viem";

export interface AnvilFork {
  port: number;
  url: string;
  process: ChildProcess;
  client: ReturnType<typeof createPublicClient> & {
    request: (req: { method: string; params?: unknown[] }) => Promise<unknown>;
  };
  stop: () => Promise<void>;
}

/** Spawn Anvil (optionally forked). One instance per decision. */
export async function startAnvilFork(opts: {
  rpcUrl?: string;
  port?: number;
  forkBlockNumber?: bigint;
  silent?: boolean;
  anvilPath?: string;
}): Promise<AnvilFork> {
  const port = opts.port ?? Math.floor(20000 + Math.random() * 20000);
  const args = ["--port", String(port), "--silent"];
  if (opts.rpcUrl) {
    args.unshift("--fork-url", opts.rpcUrl);
    if (opts.forkBlockNumber !== undefined) args.push("--fork-block-number", opts.forkBlockNumber.toString());
  }

  const proc = spawn(opts.anvilPath ?? "anvil", args, { stdio: ["ignore", "pipe", "pipe"] });
  const url = `http://127.0.0.1:${port}`;

  // Wait for readiness by polling eth_blockNumber. A local (unforked) anvil
  // starts at block 0, which is a valid block — any numeric result means ready.
  const deadline = Date.now() + 15_000;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
      });
      if (res.ok) {
        const body = (await res.json()) as { result?: string };
        if (body.result !== undefined && /^0x[0-9a-f]+$/.test(body.result)) ready = true;
      }
    } catch {
      // not up yet
    }
    if (!ready) await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) {
    proc.kill("SIGKILL");
    throw new Error(`anvil fork on port ${port} did not become ready within 15s`);
  }

  const raw = {
    request: async (req: { method: string; params?: unknown[] }) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...req }),
      });
      const body = (await res.json()) as { result?: unknown; error?: unknown };
      if (body.error) throw new Error(JSON.stringify(body.error));
      return body.result;
    },
  };
  const client = createPublicClient({
    transport: custom(raw as never),
  }) as AnvilFork["client"];

  return {
    port,
    url,
    process: proc,
    client,
    stop: async () => {
      proc.kill("SIGKILL");
      await new Promise((r) => setTimeout(r, 100));
    },
  };
}

/** Evm snapshot/revert helpers for isolated assertion runs. */
export function snapshotHelpers(client: AnvilFork["client"]) {
  return {
    snapshot: () => client.request({ method: "evm_snapshot" }) as Promise<string>,
    revert: (id: string) => client.request({ method: "evm_revert", params: [id] }) as Promise<boolean>,
    setBalance: (address: Address, amount: bigint) =>
      client.request({ method: "anvil_setBalance", params: [address, `0x${amount.toString(16)}`] }),
    impersonate: (address: Address) => client.request({ method: "anvil_impersonateAccount", params: [address] }),
    stopImpersonating: (address: Address) => client.request({ method: "anvil_stopImpersonatingAccount", params: [address] }),
    increaseTime: (seconds: number) => client.request({ method: "evm_increaseTime", params: [seconds] }),
  };
}
