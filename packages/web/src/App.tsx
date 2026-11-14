import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ApiError, decide, sabotage, Journal } from "./api";
import { PIPELINE_STEPS } from "./pipeline";
import { Scope, ScopeToggle, ScopeBanner, RoundTwoTeaser } from "./scope";
import { ThemeToggle } from "./theme";
import { Alert, Button, Spinner } from "./ui";
import { DebateView, EvidenceView, JournalView, MandateView, NotFoundView, RunState } from "./views";

// Full Vision content is only needed after the scope toggle is flipped.
const RoadmapView = lazy(() => import("./roadmap"));
// Demo data is only needed once someone starts Demo Mode or the demo sabotage.
const loadDemo = () => import("./demo");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ROUTES = ["mandate", "evidence", "debate", "journal", "roadmap"] as const;
type Route = (typeof ROUTES)[number];

const TITLES: Record<Route, string> = {
  mandate: "Mandate",
  evidence: "Evidence",
  debate: "Debate",
  journal: "Journal",
  roadmap: "Roadmap",
};

/** `#/evidence` → "evidence"; empty hash → "mandate"; anything else → null (not found). */
function parseHash(hash: string): Route | null {
  const path = hash.replace(/^#\/?/, "").replace(/\/$/, "");
  if (path === "") return "mandate";
  return (ROUTES as readonly string[]).includes(path) ? (path as Route) : null;
}

const hrefFor = (r: Route) => (r === "mandate" ? "#/" : `#/${r}`);

function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const navigate = useCallback((r: Route) => {
    window.location.hash = hrefFor(r);
  }, []);
  return { route: parseHash(hash), hash, navigate };
}

type UiError = { title: string; message: string; offline: boolean };

function toUiError(e: unknown, action: string): UiError {
  if (e instanceof ApiError) {
    if (e.kind === "offline") return { title: "No backend connected", message: e.message, offline: true };
    if (e.kind === "rejected") return { title: `The API rejected the ${action}`, message: e.message, offline: false };
    return { title: `The API failed to complete the ${action}`, message: e.message, offline: false };
  }
  return { title: `Something went wrong with the ${action}`, message: String(e), offline: false };
}

export default function App() {
  const { route, hash, navigate } = useHashRoute();
  const [scope, setScope] = useState<Scope>(route === "roadmap" ? "vision" : "prototype");
  const [run, setRun] = useState<RunState>({ kind: "idle" });
  const [sabotageBusy, setSabotageBusy] = useState(false);
  const [journal, setJournal] = useState<Journal | null>(null);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [sabotageResult, setSabotageResult] = useState<Journal | null>(null);
  const [uiError, setUiError] = useState<UiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  const showLive = scope === "prototype";
  const busy = run.kind !== "idle" || sabotageBusy;

  // Keep scope and route consistent when the URL is changed directly.
  useEffect(() => {
    if (route === "roadmap" && scope !== "vision") setScope("vision");
  }, [route, scope]);

  // Page title per view, and move focus to the content after navigation so
  // keyboard and screen-reader users land on the new view.
  useEffect(() => {
    document.title = route ? `${TITLES[route]} · IntentGuard` : "Page not found · IntentGuard";
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [route]);

  // Bring a new error into view: on phones the form's buttons sit far below it.
  useEffect(() => {
    if (uiError) errorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [uiError]);

  // Entering Full Vision jumps to the roadmap; leaving it from the roadmap falls back to Mandate.
  const changeScope = (s: Scope) => {
    setScope(s);
    if (s === "vision") navigate("roadmap");
    else if (route === "roadmap") navigate("mandate");
  };

  const record = (j: Journal) => {
    setJournal(j);
    setJournals((prev) => [j, ...prev]);
  };

  const runDecide = async (mandate: string) => {
    setRun({ kind: "live" });
    setUiError(null);
    setNotice(null);
    try {
      const j = await decide(mandate);
      record(j);
      setDemo(false);
      setNotice(`Decision ${j.intentId} recorded: ${j.finalVerdict}.`);
      navigate("evidence");
    } catch (e) {
      setUiError(toUiError(e, "decision"));
    } finally {
      setRun({ kind: "idle" });
    }
  };

  // Demo Mode: walk the full pipeline on realistic mock data, staged so it reads
  // like a live run. No backend required — works on the static deploy.
  const runDemo = async () => {
    setUiError(null);
    setNotice(null);
    setRun({ kind: "demo", step: 0 });
    navigate("mandate");
    try {
      const demoModule = loadDemo();
      for (let i = 0; i < PIPELINE_STEPS.length; i++) {
        setRun({ kind: "demo", step: i });
        await sleep(650);
      }
      const j = (await demoModule).makeDemoJournal();
      record(j);
      setDemo(true);
      setNotice(`Demo decision ${j.intentId} recorded: ${j.finalVerdict} via ${j.arbiter?.selectedSolverId}.`);
      navigate("evidence");
    } catch (e) {
      setUiError(toUiError(e, "demo"));
    } finally {
      setRun({ kind: "idle" });
    }
  };

  const runSabotage = async () => {
    setUiError(null);
    setNotice(null);
    setSabotageBusy(true);
    try {
      // In demo mode, use the realistic mock revert instead of the live backend.
      const j = demo ? (await loadDemo()).makeDemoSabotage() : await sabotage("route-c", 4);
      setSabotageResult(j);
      setJournals((prev) => [j, ...prev]);
    } catch (e) {
      setUiError(toUiError(e, "sabotage request"));
    } finally {
      setSabotageBusy(false);
    }
  };

  const nav: { id: Route; label: string; count?: number }[] = [
    { id: "mandate", label: "Mandate" },
    { id: "evidence", label: "Evidence" },
    { id: "debate", label: "Debate" },
    { id: "journal", label: "Journal", count: journals.length || undefined },
    ...(scope === "vision" ? [{ id: "roadmap" as Route, label: "Roadmap" }] : []),
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          mainRef.current?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-accent-solid focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur supports-[backdrop-filter]:bg-canvas/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 pt-3 sm:px-6">
          <a href="#/" className="flex min-w-0 items-center gap-2.5 rounded-lg" aria-label="IntentGuard home">
            <Logo />
            <span className="min-w-0">
              <span className="block text-base font-bold leading-tight tracking-tight">IntentGuard</span>
              <span className="hidden truncate text-xs text-subtle sm:block">The AI decides. The chain enforces.</span>
            </span>
          </a>
          <div className="flex shrink-0 items-center gap-2">
            {demo && (
              <span className="hidden rounded-md border border-ok/40 bg-ok/10 px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wider text-ok sm:inline">
                Demo data
              </span>
            )}
            <ScopeToggle scope={scope} onChange={changeScope} />
            <ThemeToggle />
          </div>
        </div>
        <nav aria-label="Views" className="mx-auto max-w-6xl px-2 sm:px-4">
          <ul className="scrollbar-none -mb-px flex gap-1 overflow-x-auto pt-2">
            {nav.map((t) => {
              const active = route === t.id;
              return (
                <li key={t.id} className="shrink-0">
                  <a
                    href={hrefFor(t.id)}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors ${
                      active
                        ? "border-accent text-fg"
                        : "border-transparent text-muted hover:border-line-strong hover:text-fg"
                    }`}
                  >
                    {t.label}
                    {t.count !== undefined && (
                      <span className="rounded-full bg-inset px-1.5 text-2xs font-semibold tabular-nums text-muted">
                        <span className="sr-only">(</span>
                        {t.count}
                        <span className="sr-only"> entries)</span>
                      </span>
                    )}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>

      <main
        id="main"
        ref={mainRef}
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl flex-1 space-y-4 px-4 py-6 focus:outline-none sm:px-6"
      >
        <h1 className="sr-only">{route ? `IntentGuard — ${TITLES[route]}` : "IntentGuard — page not found"}</h1>
        {route && <ScopeBanner scope={scope} />}

        {uiError && (
          <div ref={errorRef} className="scroll-mt-32">
            <Alert
              tone="warn"
              title={uiError.title}
              onDismiss={() => setUiError(null)}
              action={
                uiError.offline && (
                  <Button size="sm" variant="success" onClick={runDemo} disabled={busy}>
                    <span aria-hidden="true">▶</span> Try Demo Mode instead
                  </Button>
                )
              }
            >
              {uiError.message}
            </Alert>
          </div>
        )}
        {notice && (
          <Alert tone="ok" title={notice} onDismiss={() => setNotice(null)}>
            Review the evidence, then the debate and verdict.
          </Alert>
        )}

        {route === "mandate" && (
          <MandateView onDecide={runDecide} onDemo={runDemo} run={run} showLive={showLive} journal={journal} />
        )}
        {route === "evidence" && <EvidenceView journal={journal} showLive={showLive} />}
        {route === "debate" && <DebateView journal={journal} showLive={showLive} />}
        {route === "journal" && (
          <JournalView
            journals={journals}
            onSabotage={runSabotage}
            sabotageBusy={sabotageBusy}
            sabotageResult={sabotageResult}
            busy={busy}
            showLive={showLive}
            demo={demo}
          />
        )}
        {route === "roadmap" && (
          <Suspense
            fallback={
              <p role="status" className="flex items-center gap-2 py-12 text-sm text-muted">
                <Spinner /> Loading the roadmap…
              </p>
            }
          >
            <RoadmapView />
          </Suspense>
        )}
        {route === null && <NotFoundView path={hash} />}

        {route && scope === "prototype" && <RoundTwoTeaser onExpand={() => changeScope("vision")} />}
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-xs text-subtle sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>IntentGuard prototype · risk-aware autonomous cross-chain treasury</p>
          <a
            href="https://github.com/jeevithg090/IntentGuard"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-10 items-center text-muted underline underline-offset-2 hover:text-fg sm:min-h-0"
          >
            Source on GitHub<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </footer>
    </div>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-panel stroke-line" strokeWidth="1" />
      <path
        d="M16 5l9 3.5v6.8c0 5.6-3.8 9.9-9 11.7-5.2-1.8-9-6.1-9-11.7V8.5z"
        fill="none"
        className="stroke-accent"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path
        d="M11.5 16.2l3.2 3.2 6-6.4"
        fill="none"
        className="stroke-ok"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
