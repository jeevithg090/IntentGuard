import { useState } from "react";
import { decide, sabotage, Journal, TIER_COLORS } from "./api";
import { Scope, ScopeToggle, ScopeBanner, LiveBadge, RoundTwoTeaser, RoadmapView } from "./scope";

type Tab = "mandate" | "evidence" | "debate" | "journal" | "roadmap";

function TierBadge({ tier }: { tier: number }) {
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold border ${TIER_COLORS[tier] ?? "text-slate-400 border-line"}`}>TIER {tier}</span>;
}

// `live` marks a panel as a built Round 1 capability. In prototype scope it shows
// a LIVE badge so judges can see, at a glance, what is real and demoable now.
function Panel({ title, children, accent, live }: { title: string; children: React.ReactNode; accent?: string; live?: boolean }) {
  return (
    <section className="bg-panel border border-line rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <h3 className={`text-sm font-semibold uppercase tracking-wider ${accent ?? "text-slate-400"}`}>{title}</h3>
        {live && <LiveBadge />}
      </div>
      {children}
    </section>
  );
}

function MandateView({ onDecide, busy, showLive }: { onDecide: (m: string) => void; busy: boolean; showLive: boolean }) {
  const [mandate, setMandate] = useState("Move $5,000 USDC to the chain offering the best yield, but never use a route with a high-risk verification mechanism.");
  return (
    <div className="space-y-4">
      <Panel title="Mandate input" accent="text-accent" live={showLive}>
        <textarea
          className="w-full h-28 bg-ink border border-line rounded-lg p-3 text-sm focus:outline-none focus:border-accent"
          value={mandate}
          onChange={(e) => setMandate(e.target.value)}
          placeholder="Describe what the treasury should do, in natural language…"
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold disabled:opacity-40"
            disabled={busy}
            onClick={() => onDecide(mandate)}
          >
            {busy ? "Deciding…" : "Run the pipeline"}
          </button>
          <p className="text-xs text-slate-500">Score → adversarial review → simulation → on-chain attestation</p>
        </div>
      </Panel>
      <Panel title="Parsed constraints">
        <ul className="grid grid-cols-2 gap-2 text-sm">
          {["Asset: USDC", "Amount: $5,000", "Objective: maximize risk-adjusted yield", "Max fee: 0.5%", "Max risk tier: 2 (of 4)", "Autonomy budget: $25k/day"].map((c) => (
            <li key={c} className="bg-ink rounded px-3 py-2 border border-line">{c}</li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function EvidenceView({ journal, showLive }: { journal: Journal; showLive: boolean }) {
  return (
    <div className="space-y-4">
      <Panel title="Evidence board — every number is clickable" accent="text-accent" live={showLive}>
        <div className="space-y-3">
          {journal.profiles.map((p, i) => (
            <details key={i} className="bg-ink rounded-lg border border-line">
              <summary className="px-4 py-3 cursor-pointer flex items-center justify-between">
                <span className="text-sm font-mono">{p.settler.slice(0, 10)}…</span>
                <TierBadge tier={p.tier} />
              </summary>
              <div className="px-4 pb-4 space-y-2">
                {p.signals.map((s) => (
                  <details key={s.id} className="bg-panel rounded border border-line px-3 py-2">
                    <summary className="cursor-pointer text-xs flex items-center gap-2">
                      <span className={s.ok ? "text-ok" : "text-danger"}>{s.ok ? "✓" : "✗"}</span>
                      <span className="font-semibold">{s.label}</span>
                      <TierBadge tier={s.tierContribution} />
                    </summary>
                    <div className="mt-2 text-xs text-slate-400 space-y-1">
                      <p><span className="text-slate-500">value:</span> {String(s.value)}</p>
                      <p><span className="text-slate-500">query:</span> <code className="break-all">{s.source.detail}</code></p>
                      <p><span className="text-slate-500">observed:</span> {new Date(s.observedAt).toISOString()} {s.blockNumber ? `· block ${s.blockNumber}` : ""}</p>
                      {s.source.url && <a className="text-accent underline" href={s.source.url} target="_blank" rel="noreferrer">{s.source.url}</a>}
                    </div>
                  </details>
                ))}
              </div>
            </details>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function DebateView({ journal, showLive }: { journal: Journal; showLive: boolean }) {
  const { proposer, redTeam, arbiter } = journal;
  return (
    <div className="grid grid-cols-2 gap-4">
      <Panel title="Proposer — wants to transact" accent="text-ok" live={showLive}>
        {proposer ? (
          <div className="space-y-3 text-sm">
            <p className="text-slate-300">{proposer.argument}</p>
            <p className="text-xs text-slate-500">Recommended: {proposer.recommendedSolverId} · EV ${proposer.expectedValueUsd.toLocaleString()}</p>
            {proposer.acknowledgedTradeoffs.map((t, i) => (
              <p key={i} className="text-xs text-warn">⚠ {t}</p>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Waiting for a proposal…</p>
        )}
      </Panel>
      <Panel title="Red Team — wants to break it" accent="text-danger" live={showLive}>
        {redTeam ? (
          <div className="space-y-3 text-sm">
            {redTeam.objections.map((o, i) => (
              <div key={i} className="bg-danger/10 border border-danger/30 rounded-lg p-3">
                <p className="font-semibold text-danger">{o.severity.toUpperCase()}: {o.claim}</p>
                <p className="text-xs text-slate-400 mt-1">{o.failureChain}</p>
                <p className="text-xs text-slate-500 mt-1">evidence: {o.evidenceSignalIds.join(", ")}</p>
              </div>
            ))}
            {redTeam.injectionAttemptsDetected.map((a, i) => (
              <div key={i} className="bg-warn/10 border border-warn/40 rounded-lg p-3 text-xs">
                <span className="text-warn font-bold">INJECTION DETECTED</span> in {a.field}: “{a.quotedText}”
              </div>
            ))}
            <p className="text-xs text-slate-500">Recommendation: {redTeam.recommendation}</p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Waiting for objections…</p>
        )}
      </Panel>
      <div className="col-span-2">
        <Panel title="Arbiter verdict" accent={arbiter?.verdict === "EXECUTE" ? "text-ok" : arbiter?.verdict === "ASK" ? "text-warn" : "text-danger"}>
          {arbiter ? (
            <div className="space-y-3 text-sm">
              <p className="text-2xl font-bold">{arbiter.verdict}{arbiter.selectedSolverId ? ` — ${arbiter.selectedSolverId}` : ""}</p>
              <p className="text-slate-300">{arbiter.reasoning}</p>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-ok font-semibold mb-1">Upheld objections</p>
                  {arbiter.upheldObjections.map((o, i) => <p key={i} className="text-slate-400">• {o}</p>)}
                </div>
                <div>
                  <p className="text-slate-500 font-semibold mb-1">Dismissed objections</p>
                  {arbiter.dismissedObjections.map((o, i) => <p key={i} className="text-slate-500">• {o}</p>)}
                </div>
              </div>
              {journal.localOverrideApplied && (
                <p className="text-danger text-xs font-semibold">LOCAL POLICY CHECK OVERRODE THE MODEL — the vault would have reverted anyway.</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No verdict yet.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}

function JournalView({ journals, onSabotage, showLive }: { journals: Journal[]; onSabotage: () => void; showLive: boolean }) {
  return (
    <div className="space-y-4">
      <Panel title="Decision journal" accent="text-accent" live={showLive}>
        {journals.length === 0 ? (
          <p className="text-sm text-slate-500">No decisions recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {journals.map((j) => (
              <details key={j.intentId} className="bg-ink rounded-lg border border-line">
                <summary className="px-4 py-3 cursor-pointer flex items-center gap-3 text-sm">
                  <span className="font-mono">{j.intentId}</span>
                  <span className={j.finalVerdict === "EXECUTE" ? "text-ok" : j.finalVerdict === "ASK" ? "text-warn" : "text-danger"}>{j.finalVerdict}</span>
                  <span className="text-slate-500 text-xs">{j.quotesEvaluated} quotes · {j.injectionAttempts.length} injections · {j.simulation?.assertions.filter((a) => !a.passed).length ?? 0} failed sims</span>
                </summary>
                <pre className="px-4 pb-4 text-xs text-slate-400 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(j, null, 2)}</pre>
              </details>
            ))}
          </div>
        )}
      </Panel>
      <Panel title="Sabotage (dev-only)" accent="text-danger" live={showLive}>
        <p className="text-xs text-slate-400 mb-3">POST a forged decision straight to the backend, bypassing the agents. The vault must revert RiskTierExceedsPolicy.</p>
        <button className="px-4 py-2 rounded-lg bg-danger text-white text-sm font-semibold" onClick={onSabotage}>
          Force-select the tier-4 route
        </button>
      </Panel>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("mandate");
  const [scope, setScope] = useState<Scope>("prototype");
  const [busy, setBusy] = useState(false);
  const [journal, setJournal] = useState<Journal | null>(null);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [sabotageResult, setSabotageResult] = useState<Journal | null>(null);

  const showLive = scope === "prototype";

  // Toggling scope also fixes the active tab: entering Full Vision jumps to the
  // roadmap; leaving it (while on the roadmap tab) falls back to Mandate.
  const changeScope = (s: Scope) => {
    setScope(s);
    if (s === "vision") setTab("roadmap");
    else if (tab === "roadmap") setTab("mandate");
  };

  const runDecide = async (mandate: string) => {
    setBusy(true);
    try {
      const j = await decide(mandate);
      setJournal(j);
      setJournals((prev) => [j, ...prev]);
      setTab("evidence");
    } finally {
      setBusy(false);
    }
  };

  const runSabotage = async () => {
    const j = await sabotage("route-c", 4);
    setSabotageResult(j);
    setJournals((prev) => [j, ...prev]);
    setTab("journal");
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "mandate", label: "Mandate" },
    { id: "evidence", label: "Evidence" },
    { id: "debate", label: "Debate" },
    { id: "journal", label: "Journal + Sabotage" },
    ...(scope === "vision" ? [{ id: "roadmap" as Tab, label: "Roadmap" }] : []),
  ];

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-panel/60">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold">IntentGuard</h1>
            <p className="text-xs text-slate-500">The AI decides. The chain enforces.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  className={`px-3 py-1.5 rounded-lg text-sm ${tab === t.id ? "bg-accent text-white" : "text-slate-400 hover:text-white"}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <ScopeToggle scope={scope} onChange={changeScope} />
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-6 space-y-4">
        <ScopeBanner scope={scope} />
        {tab === "mandate" && <MandateView onDecide={runDecide} busy={busy} showLive={showLive} />}
        {tab === "evidence" && (journal ? <EvidenceView journal={journal} showLive={showLive} /> : <p className="text-slate-500 text-sm">Run a decision first.</p>)}
        {tab === "debate" && (journal ? <DebateView journal={journal} showLive={showLive} /> : <p className="text-slate-500 text-sm">Run a decision first.</p>)}
        {tab === "journal" && <JournalView journals={journals} onSabotage={runSabotage} showLive={showLive} />}
        {tab === "roadmap" && <RoadmapView />}
        {sabotageResult && tab === "journal" && (
          <p className="text-danger text-sm font-semibold">{sabotageResult.error}</p>
        )}
        {scope === "prototype" && tab !== "roadmap" && (
          <RoundTwoTeaser onExpand={() => changeScope("vision")} />
        )}
      </main>
    </div>
  );
}
