import { PublicClient, Address, parseAbi } from "viem";
import { Signal, RiskTier } from "@intentguard/core";

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";

const SAFE_ABI = parseAbi([
  "function getThreshold() view returns (uint256)",
  "function getOwners() view returns (address[])",
]);
const TIMELOCK_ABI = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function delay() view returns (uint256)",
  "function getMinDelayExecute(address) view returns (uint256)",
]);

export interface UpgradeabilityFacts {
  isProxy: boolean;
  implementation: Address | null;
  admin: Address | null;
  adminIsContract: boolean;
  safeOwners: number;
  safeThreshold: number;
  timelockSeconds: number | null;
  tier: RiskTier;
  summary: string;
}

const FAIL = (detail: string, url?: string): Signal => ({
  id: "upgradeability",
  label: "Upgradeability & admin control",
  value: null,
  tierContribution: 4,
  source: { kind: "rpc", detail, url },
  observedAt: Date.now(),
  ok: false,
});

/** Safe read: returns null on revert/error instead of throwing. */
async function tryRead(client: PublicClient, target: Address, data: `0x${string}`): Promise<`0x${string}` | null> {
  try {
    return (await client.call({ to: target, data })).data ?? null;
  } catch {
    return null;
  }
}

export function decodeSafeOwners(raw: `0x${string}` | null): string[] | null {
  if (!raw || raw.length < 130) return null;
  try {
    const body = raw.slice(2 + 64); // skip offset word
    const count = parseInt(body.slice(0, 64), 16);
    if (!Number.isFinite(count) || count > 1000) return null;
    const addrs: string[] = [];
    for (let i = 0; i < count; i++) {
      addrs.push(("0x" + body.slice(64 + i * 64 + 24, 64 + i * 64 + 64)).toLowerCase());
    }
    return addrs;
  } catch {
    return null;
  }
}

export async function scoreUpgradeability(client: PublicClient, target: Address): Promise<Signal> {
  const blockNumber = await client.getBlockNumber().catch(() => null);
  const rpcUrl = (client as { transport?: { url?: string } }).transport?.url;
  const fail = (detail: string) => FAIL(`${detail} (target ${target})`, rpcUrl);

  try {
    const [implRaw, adminRaw] = await Promise.all([
      client.getStorageAt({ address: target, slot: IMPL_SLOT }),
      client.getStorageAt({ address: target, slot: ADMIN_SLOT }),
    ]);

    const impl = implRaw && BigInt(implRaw) !== 0n ? (`0x${implRaw.slice(-40)}` as Address) : null;
    const admin = adminRaw && BigInt(adminRaw) !== 0n ? (`0x${adminRaw.slice(-40)}` as Address) : null;

    const isProxy = impl !== null;
    if (!isProxy) {
      const facts: UpgradeabilityFacts = {
        isProxy: false,
        implementation: null,
        admin: null,
        adminIsContract: false,
        safeOwners: 0,
        safeThreshold: 0,
        timelockSeconds: null,
        tier: 1,
        summary: "Not a proxy (immutable contract)",
      };
      return {
        id: "upgradeability",
        label: "Upgradeability & admin control",
        value: JSON.stringify(facts),
        tierContribution: 1,
        source: { kind: "rpc", detail: `eth_getStorageAt(target, ${IMPL_SLOT}) → 0x0; contract is immutable`, url: rpcUrl },
        observedAt: Date.now(),
        blockNumber: blockNumber ?? undefined,
        ok: true,
      };
    }

    // Proxy found. Now inspect the admin.
    let adminIsContract = false;
    if (admin) {
      const code = await client.getCode({ address: admin });
      adminIsContract = code !== undefined && code !== "0x";
    }

    let safeOwners = 0;
    let safeThreshold = 0;
    if (admin && adminIsContract) {
      const [thrRaw, ownersRaw] = await Promise.all([
        tryRead(client, admin, "0xe75235b8" as `0x${string}`), // getThreshold()
        tryRead(client, admin, "0xa0e67e2b" as `0x${string}`), // getOwners()
      ]);
      if (thrRaw) safeThreshold = parseInt(thrRaw.slice(-64), 16) || 0;
      const owners = decodeSafeOwners(ownersRaw);
      if (owners) safeOwners = owners.length;
    }

    let timelockSeconds: number | null = null;
    if (admin && adminIsContract) {
      for (const probe of [
        "0xf27a0c92" as `0x${string}`, // getMinDelay()
        "0x6a42b8f8" as `0x${string}`, // delay()
      ]) {
        const raw = await tryRead(client, admin, probe);
        if (raw) {
          const v = parseInt(raw.slice(-64), 16);
          if (Number.isFinite(v)) {
            timelockSeconds = v;
            break;
          }
        }
      }
    }

    let tier: RiskTier;
    let adminDesc: string;
    if (!adminIsContract) {
      tier = 4;
      adminDesc = `EOA 0x${(admin ?? "0x0").slice(2, 10)}…`;
    } else if (safeOwners >= 3 && timelockSeconds !== null && timelockSeconds >= 48 * 3600) {
      tier = 1;
      adminDesc = `Safe ${safeThreshold}-of-${safeOwners} + ${Math.round(timelockSeconds / 3600)}h timelock`;
    } else if (safeOwners > 0 && timelockSeconds !== null && timelockSeconds >= 6 * 3600) {
      tier = 2;
      adminDesc = `Safe ${safeThreshold}-of-${safeOwners} + ${Math.round(timelockSeconds / 3600)}h timelock`;
    } else if (safeOwners > 0) {
      tier = 3;
      adminDesc = `Safe ${safeThreshold}-of-${safeOwners}, no timelock`;
    } else {
      tier = 3;
      adminDesc = "contract admin, not a recognised Safe, no timelock";
    }

    const facts: UpgradeabilityFacts = {
      isProxy,
      implementation: impl,
      admin,
      adminIsContract,
      safeOwners,
      safeThreshold,
      timelockSeconds,
      tier,
      summary: `Proxy; admin is ${adminDesc}`,
    };
    return {
      id: "upgradeability",
      label: "Upgradeability & admin control",
      value: JSON.stringify(facts),
      tierContribution: tier,
      source: {
        kind: "rpc",
        detail: `eth_getStorageAt(target, ${IMPL_SLOT}) → impl ${impl}; admin ${admin}; ${adminDesc}`,
        url: rpcUrl,
      },
      observedAt: Date.now(),
      blockNumber: blockNumber ?? undefined,
      ok: true,
    };
  } catch (e) {
    return fail(`upgradeability read failed: ${(e as Error).message}`);
  }
}
