// Full roadmap + honest scope table, shown in Full Vision mode. Loaded lazily:
// most visitors stay in Prototype scope and never need this chunk.
import { BUILT, REAL_VS_MOCKED, ROADMAP, LiveBadge } from "./scope";
import { Badge, Card } from "./ui";

export default function RoadmapView() {
  return (
    <div className="space-y-4">
      <Card title="Round 1 — built & demoable now" accent="text-ok">
        <ul className="grid gap-3 sm:grid-cols-2">
          {BUILT.map((b) => (
            <li key={b.title} className="rounded-lg border border-ok/25 bg-inset p-3">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <LiveBadge />
                <h3 className="text-sm font-semibold">{b.title}</h3>
              </div>
              <p className="text-sm leading-relaxed text-muted">{b.live}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card
        title="Round 2 — the A–Z product"
        accent="text-accent"
        description="Planned, not built. Each item is anchored to what the prototype already proves."
      >
        <ul className="space-y-3">
          {ROADMAP.map((r) => (
            <li key={r.title} className="rounded-lg border border-dashed border-accent/40 bg-inset p-3">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <Badge tone="accent">Round 2</Badge>
                <h3 className="text-sm font-semibold">{r.title}</h3>
              </div>
              <p className="text-sm leading-relaxed text-fg">{r.round2}</p>
              <p className="mt-1 text-sm text-muted">
                <span className="font-semibold text-ok">Proven now:</span> {r.provenNow}
              </p>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="What is real vs. mocked in the prototype">
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[20rem] text-left text-sm">
            <caption className="sr-only">Which prototype layers are real and which are mocked</caption>
            <thead>
              <tr className="border-b border-line text-2xs uppercase tracking-wider text-subtle">
                <th scope="col" className="px-1 py-2 font-semibold">
                  Layer
                </th>
                <th scope="col" className="px-1 py-2 font-semibold">
                  Status
                </th>
                <th scope="col" className="px-1 py-2 font-semibold">
                  Source
                </th>
              </tr>
            </thead>
            <tbody>
              {REAL_VS_MOCKED.map((row) => (
                <tr key={row.layer} className="border-b border-line last:border-0">
                  <th scope="row" className="px-1 py-2.5 font-normal text-fg">
                    {row.layer}
                  </th>
                  <td className="px-1 py-2.5">
                    {row.real ? <Badge tone="ok">● Real</Badge> : <Badge tone="warn">○ Mocked</Badge>}
                  </td>
                  <td className="px-1 py-2.5 text-xs text-muted">{row.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
