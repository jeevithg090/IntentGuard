import { FormEvent, KeyboardEvent, useId, useState } from "react";
import type { Journal } from "./api";
import { PIPELINE_STEPS } from "./pipeline";
import { LiveBadge } from "./scope";
import { Alert, Badge, Button, Card, EmptyState, Field, Spinner, TierBadge, VERDICT_TONE, shortHex } from "./ui";

export const MANDATE_MAX = 2000;

const DEFAULT_MANDATE =
  "Move $5,000 USDC to the chain offering the best yield, but never use a route with a high-risk verification mechanism.";

const EXAMPLES: { label: string; text: string }[] = [
  { label: "Best safe yield", text: DEFAULT_MANDATE },
  {
    label: "Low-fee transfer",
    text: "Bridge $2,000 USDC to Base for the lowest fee. Stay at risk tier 1 and keep fees under 0.2%.",
  },
  {
    label: "Conservative treasury",
    text: "Park $10,000 USDC wherever the yield is highest, but only through immutable contracts with no recent incidents.",
  },
];

const DEFAULT_CONSTRAINTS: [string, string][] = [
  ["Asset", "USDC"],
  ["Amount", "$5,000"],
  ["Objective", "Maximize risk-adjusted yield"],
  ["Max fee", "0.5%"],
  ["Max risk tier", "2 (of 4)"],
  ["Autonomy budget", "$25k/day"],
];

/** "maxRiskTier" → "Max risk tier" */
const humanize = (key: string) => {
  const words = key.replace(/([A-Z])/g, " $1").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const stepLabel = (s: string) => s.replace(/…$/, "");

const routeName = (i: number) => `Route ${String.fromCharCode(65 + i)}`;

// ── Mandate ──────────────────────────────────────────────────────────────────

export type RunState = { kind: "idle" } | { kind: "live" } | { kind: "demo"; step: number };

export function MandateView({
  onDecide,
  onDemo,
  run,
  showLive,
  journal,
}: {
  onDecide: (m: string) => void;
  onDemo: () => void;
  run: RunState;
  showLive: boolean;
  journal: Journal | null;
}) {
  const [mandate, setMandate] = useState(DEFAULT_MANDATE);
  const [error, setError] = useState<string | null>(null);
  const ids = { hint: useId(), count: useId(), error: useId() };
  const busy = run.kind !== "idle";
  const length = mandate.trim().length;

  const validate = (value: string) => {
    const v = value.trim();
    if (v.length === 0) return "Describe what the treasury should do before running the pipeline.";
    if (v.length > MANDATE_MAX)
      return `Keep the mandate under ${MANDATE_MAX.toLocaleString()} characters (it is ${v.length.toLocaleString()}).`;
    return null;
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const problem = validate(mandate);
    setError(problem);
    if (!problem && !busy) onDecide(mandate.trim());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
  };

  const constraints: [string, string][] = journal
    ? Object.entries(journal.parsedConstraints).map(([k, v]) => [humanize(k), String(v)])
    : DEFAULT_CONSTRAINTS;

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-3">
        <Card
          title="Mandate"
          accent="text-accent"
          badge={showLive && <LiveBadge />}
          description="Tell the treasury agent what to do in plain language. It scores every route, argues both sides and only signs what the on-chain policy allows."
        >
          <form onSubmit={submit} noValidate>
            <label htmlFor="mandate-input" className="mb-1.5 block text-sm font-medium text-fg">
              Treasury mandate
            </label>
            <textarea
              id="mandate-input"
              rows={5}
              className={`block w-full resize-y rounded-lg border bg-inset px-3 py-2.5 text-base leading-relaxed text-fg placeholder:text-subtle transition focus:outline-none focus-visible:outline-none focus:ring-2 sm:text-sm ${
                error
                  ? "border-danger focus:ring-danger/40"
                  : "border-line-strong focus:border-accent focus:ring-accent/30"
              }`}
              value={mandate}
              onChange={(e) => {
                setMandate(e.target.value);
                if (error) setError(validate(e.target.value));
              }}
              onKeyDown={onKeyDown}
              placeholder="e.g. Move $5,000 USDC to the best yield, never above risk tier 2…"
              aria-invalid={error ? true : undefined}
              aria-describedby={`${ids.hint} ${ids.count}${error ? ` ${ids.error}` : ""}`}
              disabled={busy}
            />
            <div className="mt-1.5 flex flex-wrap items-start justify-between gap-x-4 gap-y-1 text-xs">
              <p id={ids.hint} className="text-subtle">
                Mention the asset, amount, objective and any limits on fees or risk.
                <span className="hidden sm:inline"> Press Ctrl/⌘ + Enter to run.</span>
              </p>
              <p
                id={ids.count}
                className={`tabular-nums ${length > MANDATE_MAX ? "font-semibold text-danger" : "text-subtle"}`}
              >
                {length.toLocaleString()} / {MANDATE_MAX.toLocaleString()}
              </p>
            </div>
            {error && (
              <p id={ids.error} role="alert" className="mt-2 flex items-center gap-1.5 text-sm text-danger">
                <span aria-hidden="true">!</span> {error}
              </p>
            )}

            <fieldset className="mt-4" disabled={busy}>
              <legend className="mb-2 text-xs font-medium text-subtle">Try an example</legend>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex.label}
                    type="button"
                    onClick={() => {
                      setMandate(ex.text);
                      setError(null);
                    }}
                    aria-pressed={mandate === ex.text}
                    className="min-h-9 rounded-full border border-line-strong px-3 text-xs text-muted transition hover:border-accent hover:text-fg disabled:opacity-50 aria-pressed:border-accent aria-pressed:bg-accent/10 aria-pressed:text-accent"
                  >
                    {ex.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:flex-wrap sm:items-center">
              <Button type="submit" variant="primary" loading={run.kind === "live"} disabled={busy}>
                {run.kind === "live" ? "Deciding…" : "Run the pipeline"}
              </Button>
              {/* Demo Mode runs the whole flow with realistic mock data — no backend
                  needed, so the static deploy shows the full product end to end. */}
              <Button
                variant="success"
                onClick={onDemo}
                loading={run.kind === "demo"}
                disabled={busy}
                icon={<span aria-hidden="true">▶</span>}
              >
                {run.kind === "demo" ? "Running demo…" : "Demo Mode"}
              </Button>
              <p className="text-xs text-subtle sm:ml-auto">No backend? Demo Mode runs on realistic mock data.</p>
            </div>
          </form>
        </Card>
      </div>

      <div className="space-y-4 lg:col-span-2">
        <PipelineCard run={run} />
        <Card
          title="Parsed constraints"
          description={
            journal ? (
              <>
                From <span className="font-mono text-xs">{journal.intentId}</span>
              </>
            ) : (
              "Example policy, until your first decision runs."
            )
          }
        >
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {constraints.map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line bg-inset px-3 py-2">
                <dt className="text-2xs font-semibold uppercase tracking-wider text-subtle">{k}</dt>
                <dd className="mt-0.5 text-sm text-fg">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  );
}

function PipelineCard({ run }: { run: RunState }) {
  const current = run.kind === "demo" ? run.step : -1;
  return (
    <Card
      title="Pipeline"
      description={
        run.kind === "live"
          ? "Waiting for the API to finish the decision…"
          : run.kind === "demo"
            ? `Demo step ${current + 1} of ${PIPELINE_STEPS.length}`
            : "What happens when you run a mandate."
      }
    >
      <ol className="space-y-1" aria-live="polite">
        {PIPELINE_STEPS.map((s, i) => {
          const state = run.kind === "demo" ? (i < current ? "done" : i === current ? "current" : "pending") : "idle";
          return (
            <li
              key={s}
              aria-current={state === "current" ? "step" : undefined}
              className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors ${
                state === "current" ? "bg-accent/10 text-fg" : state === "done" ? "text-muted" : "text-muted"
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-2xs font-bold ${
                  state === "done"
                    ? "border-ok/50 bg-ok/15 text-ok"
                    : state === "current"
                      ? "border-accent text-accent"
                      : "border-line-strong text-subtle"
                }`}
              >
                {state === "done" ? "✓" : state === "current" ? <Spinner className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className="min-w-0">{stepLabel(s)}</span>
              {state === "done" && <span className="sr-only"> (done)</span>}
              {state === "current" && <span className="sr-only"> (in progress)</span>}
            </li>
          );
        })}
      </ol>
      {run.kind === "live" && (
        <p className="mt-3 flex items-center gap-2 text-xs text-accent" role="status">
          <Spinner className="h-3.5 w-3.5" /> Running against the API — this can take a few seconds.
        </p>
      )}
    </Card>
  );
}

// ── Decision summary (shared by Evidence and Debate) ─────────────────────────

export function DecisionSummary({
  journal,
  onNext,
  nextLabel,
}: {
  journal: Journal;
  onNext?: string;
  nextLabel?: string;
}) {
  const sims = journal.simulation?.assertions ?? [];
  const passed = sims.filter((a) => a.passed).length;
  const tone = VERDICT_TONE[journal.finalVerdict] ?? "neutral";
  const border =
    { ok: "border-ok/40", warn: "border-warn/40", danger: "border-danger/40" }[tone as string] ?? "border-line";
  const text = { ok: "text-ok", warn: "text-warn", danger: "text-danger" }[tone as string] ?? "text-fg";
  return (
    <section
      aria-labelledby="summary-title"
      className={`animate-fade-in rounded-xl border bg-panel p-4 shadow-card sm:p-5 ${border}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-2xs font-semibold uppercase tracking-wider text-subtle">Final verdict</p>
          <h2 id="summary-title" className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={`text-2xl font-bold tracking-tight ${text}`}>{journal.finalVerdict}</span>
            {journal.arbiter?.selectedSolverId && (
              <span className="text-base font-medium text-muted">via {journal.arbiter.selectedSolverId}</span>
            )}
          </h2>
        </div>
        {onNext && (
          <a
            href={onNext}
            className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-semibold text-accent hover:bg-accent/10"
          >
            {nextLabel} <span aria-hidden="true">&nbsp;→</span>
          </a>
        )}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Field label="Intent" mono>
          {journal.intentId}
        </Field>
        <Field label="Quotes evaluated">{journal.quotesEvaluated}</Field>
        <Field label="Injections caught">{journal.injectionAttempts.length}</Field>
        <Field label="Simulation">{sims.length ? `${passed}/${sims.length} checks passed` : "Not run"}</Field>
        {journal.attestation && (
          <Field label="Attested tier">
            <TierBadge tier={journal.attestation.riskTier} />
          </Field>
        )}
        {journal.txHash && (
          <Field label="Transaction" mono>
            <span title={journal.txHash}>{shortHex(journal.txHash)}</span>
          </Field>
        )}
      </dl>
      {journal.error && (
        <div className="mt-4">
          <Alert tone="danger" title="The pipeline stopped with an error">
            {journal.error}
          </Alert>
        </div>
      )}
    </section>
  );
}

function NeedsDecision({ demoAvailable }: { demoAvailable: boolean }) {
  return (
    <EmptyState
      icon="◎"
      title="No decision yet"
      action={
        <a
          href="#/"
          className="inline-flex min-h-11 items-center rounded-lg bg-accent-solid px-4 text-sm font-semibold text-white hover:brightness-110"
        >
          Go to Mandate
        </a>
      }
    >
      Run a mandate through the pipeline{demoAvailable ? " (or start Demo Mode)" : ""} and the evidence, debate and
      verdict for it appear here.
    </EmptyState>
  );
}

// ── Evidence ─────────────────────────────────────────────────────────────────

export function EvidenceView({ journal, showLive }: { journal: Journal | null; showLive: boolean }) {
  if (!journal) return <NeedsDecision demoAvailable />;
  return (
    <div className="space-y-4">
      <DecisionSummary journal={journal} onNext="#/debate" nextLabel="See the debate" />
      <Card
        title="Evidence board"
        accent="text-accent"
        badge={showLive && <LiveBadge />}
        description="Each route's risk tier is derived from cited on-chain and API evidence. Expand a route, then a signal, to see the exact query behind it."
      >
        {journal.profiles.length === 0 ? (
          <p className="text-sm text-muted">This decision has no scored routes.</p>
        ) : (
          <ul className="space-y-3">
            {journal.profiles.map((p, i) => {
              const failing = p.signals.filter((s) => s.tierContribution >= 3).length;
              return (
                <li key={p.settler + i}>
                  <details className="group rounded-lg border border-line bg-inset transition-colors open:border-line-strong">
                    <summary className="flex min-h-12 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2.5 hover:bg-panel/60 sm:px-4">
                      <Chevron />
                      <span className="text-sm font-semibold">{routeName(i)}</span>
                      <span className="font-mono text-xs text-muted" title={p.settler}>
                        {shortHex(p.settler)}
                      </span>
                      <span className="ml-auto flex items-center gap-2">
                        <span className="hidden text-xs text-subtle sm:inline">
                          {p.signals.length} signals{failing ? ` · ${failing} high-risk` : ""}
                        </span>
                        <TierBadge tier={p.tier} />
                      </span>
                    </summary>
                    <div className="space-y-3 border-t border-line px-3 pb-4 pt-3 sm:px-4">
                      {p.rationale.length > 0 && (
                        <ul className="list-disc space-y-1 pl-5 text-sm text-muted marker:text-subtle">
                          {p.rationale.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                      )}
                      <ul className="space-y-2">
                        {p.signals.map((s) => (
                          <li key={s.id}>
                            <details className="rounded-md border border-line bg-panel">
                              <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-inset">
                                <Chevron />
                                <span
                                  className={s.ok ? "text-ok" : "text-danger"}
                                  aria-label={s.ok ? "Read succeeded" : "Read failed"}
                                  role="img"
                                >
                                  {s.ok ? "✓" : "✗"}
                                </span>
                                <span className="min-w-0 flex-1 font-medium">{s.label}</span>
                                <TierBadge tier={s.tierContribution} />
                              </summary>
                              <dl className="grid gap-3 border-t border-line px-3 py-3 sm:grid-cols-2">
                                <Field label="Value">{String(s.value)}</Field>
                                <Field label="Observed">
                                  {new Date(s.observedAt).toLocaleString()}
                                  {s.blockNumber ? ` · block ${s.blockNumber}` : ""}
                                </Field>
                                <div className="sm:col-span-2">
                                  <Field label={`Query (${s.source.kind})`} mono>
                                    {s.source.detail}
                                  </Field>
                                </div>
                                {s.source.url && (
                                  <div className="sm:col-span-2">
                                    <Field label="Source">
                                      <a
                                        className="text-accent underline underline-offset-2 hover:no-underline"
                                        href={s.source.url}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        {s.source.url}
                                        <span className="sr-only"> (opens in a new tab)</span>
                                      </a>
                                    </Field>
                                  </div>
                                )}
                              </dl>
                            </details>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Chevron() {
  return (
    <svg className="chevron h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M7.2 4.8a.75.75 0 0 1 1.06 0l4.67 4.67a.75.75 0 0 1 0 1.06L8.26 15.2a.75.75 0 1 1-1.06-1.06L11.34 10 7.2 5.86a.75.75 0 0 1 0-1.06z" />
    </svg>
  );
}

// ── Debate ───────────────────────────────────────────────────────────────────

const SEVERITY_TONE: Record<string, "danger" | "warn" | "neutral"> = {
  critical: "danger",
  high: "danger",
  medium: "warn",
  low: "neutral",
};

export function DebateView({ journal, showLive }: { journal: Journal | null; showLive: boolean }) {
  if (!journal) return <NeedsDecision demoAvailable />;
  const { proposer, redTeam, arbiter, simulation, attestation } = journal;
  const verdictTone = arbiter ? VERDICT_TONE[arbiter.verdict] : "neutral";
  return (
    <div className="space-y-4">
      <DecisionSummary journal={journal} onNext="#/journal" nextLabel="Open the journal" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Proposer — wants to transact" accent="text-ok" badge={showLive && <LiveBadge />}>
          {proposer ? (
            <div className="space-y-3 text-sm">
              <p className="leading-relaxed text-fg">{proposer.argument}</p>
              <div className="flex flex-wrap gap-2">
                <Badge tone="neutral">Recommends {proposer.recommendedSolverId}</Badge>
                <Badge tone="neutral">EV ${proposer.expectedValueUsd.toLocaleString()}</Badge>
              </div>
              {proposer.acknowledgedTradeoffs.length > 0 && (
                <ul className="space-y-1.5">
                  {proposer.acknowledgedTradeoffs.map((t) => (
                    <li key={t} className="flex gap-2 text-sm text-warn">
                      <span aria-hidden="true">⚠</span>
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">No proposal in this decision.</p>
          )}
        </Card>
        <Card title="Red Team — wants to break it" accent="text-danger" badge={showLive && <LiveBadge />}>
          {redTeam ? (
            <div className="space-y-3 text-sm">
              {redTeam.objections.map((o) => (
                <article key={o.claim} className="rounded-lg border border-danger/30 bg-danger/5 p-3">
                  <div className="flex flex-wrap items-start gap-2">
                    <Badge tone={SEVERITY_TONE[o.severity] ?? "neutral"}>{o.severity}</Badge>
                    <p className="min-w-0 flex-1 font-semibold text-fg">{o.claim}</p>
                  </div>
                  <p className="mt-2 leading-relaxed text-muted">{o.failureChain}</p>
                  <p className="mt-2 text-xs text-subtle">
                    Evidence: <span className="font-mono">{o.evidenceSignalIds.join(", ")}</span>
                  </p>
                </article>
              ))}
              {redTeam.injectionAttemptsDetected.map((a) => (
                <div key={a.field + a.quotedText} className="rounded-lg border border-warn/40 bg-warn/5 p-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-warn">Prompt injection detected</p>
                  <p className="mt-1 text-muted">
                    In <span className="font-mono text-xs">{a.field}</span>: “{a.quotedText}”
                  </p>
                </div>
              ))}
              <p className="text-xs text-subtle">
                Recommendation: <span className="font-semibold text-fg">{redTeam.recommendation}</span>
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted">No Red Team review in this decision.</p>
          )}
        </Card>
      </div>

      <Card
        title="Arbiter verdict"
        accent={verdictTone === "ok" ? "text-ok" : verdictTone === "warn" ? "text-warn" : "text-danger"}
      >
        {arbiter ? (
          <div className="space-y-4 text-sm">
            <p className="flex flex-wrap items-center gap-3">
              <Badge tone={verdictTone} className="px-2 py-1 text-xs">
                {arbiter.verdict}
              </Badge>
              {arbiter.selectedSolverId && <span className="font-semibold">{arbiter.selectedSolverId}</span>}
            </p>
            <p className="leading-relaxed text-fg">{arbiter.reasoning}</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <h3 className="mb-1.5 text-xs font-semibold text-ok">Upheld objections</h3>
                <ObjectionList items={arbiter.upheldObjections} />
              </div>
              <div>
                <h3 className="mb-1.5 text-xs font-semibold text-muted">Dismissed objections</h3>
                <ObjectionList items={arbiter.dismissedObjections} />
              </div>
            </div>
            {journal.localOverrideApplied && (
              <Alert tone="danger" title="Local policy check overrode the model">
                The vault would have reverted this order anyway.
              </Alert>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted">No verdict in this decision.</p>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card
          title="Fork simulation"
          description={simulation ? `Replayed at block ${simulation.blockNumber}` : undefined}
        >
          {simulation ? (
            <ul className="space-y-2">
              {simulation.assertions.map((a) => (
                <li key={a.id} className="flex gap-2.5 rounded-lg border border-line bg-inset px-3 py-2 text-sm">
                  <span
                    role="img"
                    aria-label={a.passed ? "Passed" : "Failed"}
                    className={`mt-0.5 ${a.passed ? "text-ok" : "text-danger"}`}
                  >
                    {a.passed ? "✓" : "✗"}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium text-fg">{a.label}</p>
                    <p className="break-words text-xs text-muted">{a.observed}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No route was simulated for this decision.</p>
          )}
        </Card>
        <Card title="Attestation" description={attestation ? "Signed for the PolicyVault to re-check" : undefined}>
          {attestation ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Risk tier">
                <TierBadge tier={attestation.riskTier} />
              </Field>
              <Field label="Fee">{(attestation.feeBps / 100).toFixed(2)}%</Field>
              <Field label="Expires">{new Date(attestation.expiry * 1000).toLocaleTimeString()}</Field>
              <Field label="Nonce" mono>
                {attestation.nonce}
              </Field>
              <div className="col-span-2">
                <Field label="Order ID" mono>
                  {attestation.orderId}
                </Field>
              </div>
              <div className="col-span-2">
                <Field label="Simulation hash" mono>
                  {attestation.simHash}
                </Field>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted">
              Nothing was attested. IntentGuard only signs decisions it would execute.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

function ObjectionList({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="text-sm text-subtle">None</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-muted marker:text-subtle">
      {items.map((o) => (
        <li key={o}>{o}</li>
      ))}
    </ul>
  );
}

// ── Journal + sabotage ───────────────────────────────────────────────────────

export function JournalView({
  journals,
  onSabotage,
  sabotageBusy,
  sabotageResult,
  busy,
  showLive,
  demo,
}: {
  journals: Journal[];
  onSabotage: () => void;
  sabotageBusy: boolean;
  sabotageResult: Journal | null;
  busy: boolean;
  showLive: boolean;
  demo: boolean;
}) {
  return (
    <div className="space-y-4">
      <Card
        title="Sabotage test"
        accent="text-danger"
        badge={showLive && <LiveBadge />}
        description={
          <>
            Simulate a compromised agent: POST a forged decision that force-selects the Tier 4 route, signed by the real
            attestor key. The vault must still revert with{" "}
            <code className="font-mono text-xs">RiskTierExceedsPolicy</code>.
            {demo ? " (Demo Mode: shows a recorded revert.)" : " Needs the API running with sabotage enabled."}
          </>
        }
      >
        <Button variant="danger" onClick={onSabotage} loading={sabotageBusy} disabled={busy}>
          {sabotageBusy ? "Submitting forged order…" : "Force-select the Tier 4 route"}
        </Button>
        {sabotageResult?.error && (
          <div className="mt-4">
            {sabotageResult.finalVerdict === "REFUSE" ? (
              <Alert tone="ok" title="The chain enforced the policy">
                {sabotageResult.error}
              </Alert>
            ) : (
              // The live API only records the forged decision; the revert happens
              // when the attested order is submitted to the PolicyVault.
              <Alert tone="accent" title={`Forged decision recorded (${sabotageResult.intentId})`}>
                {sabotageResult.error} Run <code className="font-mono text-xs">pnpm sabotage</code> against a deployed
                vault to see the on-chain revert.
              </Alert>
            )}
          </div>
        )}
      </Card>

      <Card
        title="Decision journal"
        accent="text-accent"
        badge={showLive && <LiveBadge />}
        description="Every decision this session, newest first, with the full record behind it."
      >
        {journals.length === 0 ? (
          <EmptyState icon="☰" title="The journal is empty">
            Decisions and sabotage attempts you run are recorded here.
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {journals.map((j, i) => (
              <li key={`${j.intentId}-${i}`}>
                <JournalEntry journal={j} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function JournalEntry({ journal: j }: { journal: Journal }) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(j, null, 2);
  const failed = j.simulation?.assertions.filter((a) => !a.passed).length ?? 0;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <details className="rounded-lg border border-line bg-inset open:border-line-strong">
      <summary className="flex min-h-12 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2.5 hover:bg-panel/60 sm:px-4">
        <Chevron />
        <span className="min-w-0 break-all font-mono text-xs text-fg">{j.intentId}</span>
        <Badge tone={VERDICT_TONE[j.finalVerdict] ?? "neutral"}>{j.finalVerdict}</Badge>
        <span className="w-full pl-6 text-xs text-subtle sm:ml-auto sm:w-auto sm:pl-0">
          {j.quotesEvaluated} quotes · {j.injectionAttempts.length} injections · {failed} failed sims ·{" "}
          {new Date(j.createdAt).toLocaleTimeString()}
        </span>
      </summary>
      <div className="border-t border-line px-3 pb-3 pt-2 sm:px-4">
        <div className="mb-2 flex justify-end">
          <Button size="sm" variant="ghost" onClick={copy} aria-live="polite">
            {copied ? "Copied ✓" : "Copy JSON"}
          </Button>
        </div>
        <pre className="max-h-96 overflow-auto rounded-md bg-canvas p-3 text-xs leading-relaxed text-muted">{json}</pre>
      </div>
    </details>
  );
}

// ── Not found ────────────────────────────────────────────────────────────────

export function NotFoundView({ path }: { path: string }) {
  return (
    <EmptyState
      icon="?"
      title="Page not found"
      action={
        <a
          href="#/"
          className="inline-flex min-h-11 items-center rounded-lg bg-accent-solid px-4 text-sm font-semibold text-white hover:brightness-110"
        >
          Back to Mandate
        </a>
      }
    >
      There is no view at <code className="font-mono text-xs text-fg">{path}</code>. Use the navigation above or go back
      to the start.
    </EmptyState>
  );
}
