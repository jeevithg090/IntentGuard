// Scope model for the Round 1 (Prototype) ⟷ Full Vision (Round 2) toggle.
//
// Grounded in idea.md:
//  - The "Prototype" section's real-vs-mocked table is the source of truth for
//    what is LIVE in Round 1.
//  - The Round 2 items are the boundaries idea.md itself names as *not* built:
//    solver quotes are mocked (real solver network is future), the attestor is a
//    single EOA ("Be honest about the trust boundary" → committee/TEE is future),
//    and Roles/CFO governance + the standing enterprise mandate are the product
//    vision under "The Real Innovation".
//
// The whole point of the toggle: let judges see, at a glance, the exact line
// between "we built and can demo this now" and "this is the Round 2 A–Z product."

export type Scope = "prototype" | "vision";

export interface BuiltCapability {
  title: string;
  live: string; // what is genuinely real/demoable now
}

export interface RoadmapItem {
  title: string;
  round2: string; // what the A–Z build adds
  provenNow: string; // the Round 1 proof it stands on
}

// ROUND 1 — actually built, real, demoable live at judging.
export const BUILT: BuiltCapability[] = [
  {
    title: "Evidence-Grounded Risk Oracle",
    live: "Live EIP-1967 proxy / admin / timelock reads + DefiLlama TVL & incident feed. Every number is clickable to its source.",
  },
  {
    title: "Adversarial Multi-Agent Review",
    live: "Proposer / Red Team / Arbiter run for real (Gemini). The dissent is preserved in the journal.",
  },
  {
    title: "Prompt-Injection Screening",
    live: "Solver metadata is treated as attacker-controlled input and screened before it reaches an agent's context.",
  },
  {
    title: "Simulate Before Signing",
    live: "Anvil mainnet fork replays the route and asserts on real state — honeypots, fee-on-transfer, unlimited approvals caught pre-signing.",
  },
  {
    title: "On-Chain Policy Vault",
    live: "Deployed Solidity. Independently re-checks every order and reverts anything out of policy — even a forged one from a compromised agent.",
  },
  {
    title: "Continuous Drift Monitor + Kill Switch",
    live: "Re-scores open positions live; a proxy upgrade or TVL collapse escalates and can pause the vault.",
  },
];

// ROUND 2 — the A–Z product. Explicitly NOT built for the hackathon.
export const ROADMAP: RoadmapItem[] = [
  {
    title: "Live solver network",
    round2: "Replace the 3 mocked solvers with a real ERC-7683 auction across Across, UniswapX, CoW and Eco.",
    provenNow: "Quote generation is mocked; every layer downstream of it is already real.",
  },
  {
    title: "Attestor committee",
    round2: "m-of-n threshold signature or a TEE with remote attestation, replacing the single prototype signing key.",
    provenNow: "The vault already re-checks the attestation independently — a leaked key still can't exceed policy.",
  },
  {
    title: "Roles & governance",
    round2: "Treasury ops proposes, CFO co-signs above a threshold; org-level multi-sig over the policy.",
    provenNow: "The three-state EXECUTE / ASK / REFUSE model and on-chain policy are in place today.",
  },
  {
    title: "Standing enterprise mandate",
    round2: "\"Keep treasury above 15% APY, never >20% to Tier 3, human approval above $100k\" — continuously evaluated.",
    provenNow: "One mandate → one enforced decision works end-to-end right now.",
  },
  {
    title: "Production capital & mainnet",
    round2: "Real funds, real bridges, audited contracts, monitored key custody.",
    provenNow: "Deployed on testnet + mainnet forks; contracts fuzzed and invariant-tested.",
  },
  {
    title: "24/7 autonomous operation",
    round2: "Continuous opportunity discovery and rebalancing across chains, at treasury scale.",
    provenNow: "The drift monitor already re-evaluates positions on an interval.",
  },
];

// The honest "what's live vs mocked" table, straight from idea.md § Prototype.
export const REAL_VS_MOCKED: { layer: string; real: boolean; note: string }[] = [
  { layer: "Solver quote generation", real: false, note: "3 simulated solvers" },
  { layer: "Upgradeability / admin / timelock reads", real: true, note: "live RPC" },
  { layer: "TVL, trend, incident feed", real: true, note: "DefiLlama" },
  { layer: "Adversarial multi-agent review", real: true, note: "Gemini" },
  { layer: "Prompt-injection screening", real: true, note: "" },
  { layer: "Fork simulation & assertions", real: true, note: "Anvil fork" },
  { layer: "Policy Vault enforcement", real: true, note: "deployed Solidity" },
  { layer: "Drift monitoring", real: true, note: "live re-scoring" },
];

// ── Components ───────────────────────────────────────────────────────────────

export function ScopeToggle({ scope, onChange }: { scope: Scope; onChange: (s: Scope) => void }) {
  const on = scope === "prototype";
  return (
    <button
      onClick={() => onChange(on ? "vision" : "prototype")}
      className="flex items-center gap-2 rounded-lg border border-line bg-ink px-2.5 py-1.5 text-xs"
      title="Toggle between the Round 1 prototype scope and the full Round 2 product vision"
    >
      <span className={on ? "font-semibold text-ok" : "text-slate-500"}>Round 1 · Prototype</span>
      <span className={`relative inline-block h-4 w-8 rounded-full transition-colors ${on ? "bg-ok/30" : "bg-accent/30"}`}>
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full transition-all ${on ? "left-0.5 bg-ok" : "left-4 bg-accent"}`}
        />
      </span>
      <span className={!on ? "font-semibold text-accent" : "text-slate-500"}>Full Vision</span>
    </button>
  );
}

export function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-ok/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ok">
      <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Live
    </span>
  );
}

export function ScopeBanner({ scope }: { scope: Scope }) {
  if (scope === "prototype") {
    return (
      <div className="rounded-xl border border-ok/30 bg-ok/5 px-5 py-3 text-sm">
        <span className="font-semibold text-ok">Round 1 · Prototype.</span>{" "}
        <span className="text-slate-300">
          Everything below is built and demoable live. This is deliberately not the A–Z product —
        </span>{" "}
        <span className="text-slate-400">flip to Full Vision to see the Round 2 roadmap it sets up.</span>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 px-5 py-3 text-sm">
      <span className="font-semibold text-accent">Full Vision · the A–Z product.</span>{" "}
      <span className="text-slate-300">
        Dashed cards below are Round 2 — planned, not yet built. Each one stands on something the Round 1 prototype already proves.
      </span>
    </div>
  );
}

// Compact "there is potential" indicator, shown in prototype mode only.
export function RoundTwoTeaser({ onExpand }: { onExpand: () => void }) {
  return (
    <section className="rounded-xl border border-dashed border-accent/40 bg-panel p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-accent">
          Round 2 potential — the full product
        </h3>
        <button onClick={onExpand} className="text-xs text-accent underline">
          See the roadmap →
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {ROADMAP.map((r) => (
          <span key={r.title} className="rounded border border-dashed border-line px-2.5 py-1 text-xs text-slate-400">
            {r.title}
          </span>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        {BUILT.length} core capabilities are built for Round 1. {ROADMAP.length} more are mapped for the Round 2 A–Z build.
      </p>
    </section>
  );
}

// Full roadmap + honest scope table, shown in vision mode.
export function RoadmapView() {
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-line bg-panel p-5">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ok">Round 1 — built &amp; demoable now</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {BUILT.map((b) => (
            <div key={b.title} className="rounded-lg border border-ok/25 bg-ink p-3">
              <div className="mb-1 flex items-center gap-2">
                <LiveBadge />
                <span className="text-sm font-semibold">{b.title}</span>
              </div>
              <p className="text-xs text-slate-400">{b.live}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-line bg-panel p-5">
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wider text-accent">Round 2 — the A–Z product</h3>
        <p className="mb-3 text-xs text-slate-500">Planned, not built. Each item is anchored to what the prototype already proves.</p>
        <div className="space-y-2">
          {ROADMAP.map((r) => (
            <div key={r.title} className="rounded-lg border border-dashed border-accent/40 bg-ink p-3">
              <div className="mb-1 flex items-center gap-2">
                <span className="rounded border border-accent/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
                  Round 2
                </span>
                <span className="text-sm font-semibold">{r.title}</span>
              </div>
              <p className="text-xs text-slate-300">{r.round2}</p>
              <p className="mt-1 text-xs text-slate-500">
                <span className="text-ok">Proven now:</span> {r.provenNow}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-line bg-panel p-5">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          What is real vs. mocked in the prototype
        </h3>
        <table className="w-full text-sm">
          <tbody>
            {REAL_VS_MOCKED.map((row) => (
              <tr key={row.layer} className="border-b border-line last:border-0">
                <td className="py-2 pr-3 text-slate-300">{row.layer}</td>
                <td className="py-2 pr-3">
                  {row.real ? (
                    <span className="text-ok">● Real</span>
                  ) : (
                    <span className="text-warn">○ Mocked</span>
                  )}
                </td>
                <td className="py-2 text-xs text-slate-500">{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
