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

import { Badge } from "./ui";

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
    round2: '"Keep treasury above 15% APY, never >20% to Tier 3, human approval above $100k" — continuously evaluated.',
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
      type="button"
      role="switch"
      aria-checked={!on}
      aria-label="Show full product vision"
      onClick={() => onChange(on ? "vision" : "prototype")}
      className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line bg-panel px-2.5 text-xs transition hover:bg-inset"
      title="Toggle between the Round 1 prototype scope and the full Round 2 product vision"
    >
      {/* On narrow screens only the active side is labelled, to leave room for the brand. */}
      <span className={on ? "font-semibold text-ok" : "hidden text-subtle sm:inline"}>
        Prototype<span className="hidden sm:inline"> · Round 1</span>
      </span>
      <span
        aria-hidden="true"
        className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-ok/25" : "bg-accent/25"}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full shadow transition-all ${on ? "left-0.5 bg-ok" : "left-[1.125rem] bg-accent"}`}
        />
      </span>
      <span className={!on ? "font-semibold text-accent" : "hidden text-subtle sm:inline"}>Full Vision</span>
    </button>
  );
}

export function LiveBadge() {
  return (
    <Badge tone="ok">
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ok" /> Live
    </Badge>
  );
}

export function ScopeBanner({ scope }: { scope: Scope }) {
  if (scope === "prototype") {
    return (
      <p className="rounded-xl border border-ok/30 bg-ok/5 px-4 py-3 text-sm leading-relaxed">
        <span className="font-semibold text-ok">Round 1 · Prototype.</span>{" "}
        <span className="text-fg">
          Everything marked <span className="font-semibold text-ok">Live</span> is built and demoable now.
        </span>{" "}
        <span className="text-muted">Flip to Full Vision to see the Round 2 roadmap it sets up.</span>
      </p>
    );
  }
  return (
    <p className="rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm leading-relaxed">
      <span className="font-semibold text-accent">Full Vision · the A–Z product.</span>{" "}
      <span className="text-fg">
        Dashed cards are Round 2: planned, not yet built. Each one stands on something the Round 1 prototype already
        proves.
      </span>
    </p>
  );
}

// Compact "there is potential" indicator, shown in prototype mode only.
export function RoundTwoTeaser({ onExpand }: { onExpand: () => void }) {
  return (
    <section
      aria-labelledby="teaser-title"
      className="rounded-xl border border-dashed border-accent/40 bg-panel/60 p-4 sm:p-5"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="teaser-title" className="text-xs font-semibold uppercase tracking-wider text-accent">
          Round 2 potential — the full product
        </h2>
        <button
          type="button"
          onClick={onExpand}
          className="-mx-2 min-h-10 rounded-lg px-2 text-sm font-semibold text-accent hover:bg-accent/10"
        >
          See the roadmap <span aria-hidden="true">→</span>
        </button>
      </div>
      <ul className="flex flex-wrap gap-2">
        {ROADMAP.map((r) => (
          <li
            key={r.title}
            className="rounded-md border border-dashed border-line-strong px-2.5 py-1 text-xs text-muted"
          >
            {r.title}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-subtle">
        {BUILT.length} core capabilities are built for Round 1. {ROADMAP.length} more are mapped for the Round 2 A–Z
        build.
      </p>
    </section>
  );
}
