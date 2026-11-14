// Shared UI primitives: one place for button, card, badge, alert and empty-state
// styling so every view uses the same spacing, radius, typography and colours.
import { ButtonHTMLAttributes, ReactNode } from "react";

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

// ── Button ───────────────────────────────────────────────────────────────────

type Variant = "primary" | "secondary" | "success" | "danger" | "ghost";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent-solid text-white hover:brightness-110 active:brightness-95",
  secondary: "border border-line-strong bg-panel text-fg hover:bg-inset",
  success: "border border-ok/50 text-ok hover:bg-ok/10",
  danger: "bg-danger-solid text-white hover:brightness-110 active:brightness-95",
  ghost: "text-muted hover:bg-inset hover:text-fg",
};

const SIZES: Record<Size, string> = {
  // Both sizes keep a ≥ 40px hit area (44px for md) for touch.
  sm: "min-h-10 px-3 text-sm",
  md: "min-h-11 px-4 text-sm",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex select-none items-center justify-center gap-2 rounded-lg font-semibold transition",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("h-4 w-4 animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

export function Card({
  title,
  description,
  accent,
  actions,
  badge,
  children,
  className,
  headingLevel = 2,
}: {
  title?: ReactNode;
  description?: ReactNode;
  accent?: string;
  actions?: ReactNode;
  badge?: ReactNode;
  children?: ReactNode;
  className?: string;
  headingLevel?: 2 | 3;
}) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <section className={cx("animate-fade-in rounded-xl border border-line bg-panel p-4 shadow-card sm:p-5", className)}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <H className={cx("text-xs font-semibold uppercase tracking-wider", accent ?? "text-muted")}>{title}</H>
              {badge}
            </div>
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

// ── Badge ────────────────────────────────────────────────────────────────────

export type Tone = "ok" | "teal" | "warn" | "danger" | "accent" | "neutral";

const TONES: Record<Tone, string> = {
  ok: "border-ok/40 bg-ok/10 text-ok",
  teal: "border-teal/40 bg-teal/10 text-teal",
  warn: "border-warn/40 bg-warn/10 text-warn",
  danger: "border-danger/40 bg-danger/10 text-danger",
  accent: "border-accent/40 bg-accent/10 text-accent",
  neutral: "border-line-strong bg-inset text-muted",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wider",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export const TIER_TONE: Record<number, Tone> = { 1: "ok", 2: "teal", 3: "warn", 4: "danger" };

export function TierBadge({ tier }: { tier: number }) {
  return (
    <Badge tone={TIER_TONE[tier] ?? "neutral"}>
      <span className="sr-only">Risk </span>Tier {tier}
    </Badge>
  );
}

export const VERDICT_TONE: Record<string, Tone> = { EXECUTE: "ok", ASK: "warn", REFUSE: "danger" };

// ── Alert ────────────────────────────────────────────────────────────────────

export function Alert({
  tone,
  title,
  children,
  onDismiss,
  action,
}: {
  tone: "ok" | "warn" | "danger" | "accent";
  title: ReactNode;
  children?: ReactNode;
  onDismiss?: () => void;
  action?: ReactNode;
}) {
  const icon = tone === "ok" ? "✓" : tone === "accent" ? "i" : "!";
  return (
    <div
      role={tone === "danger" || tone === "warn" ? "alert" : "status"}
      className={cx("flex animate-fade-in gap-3 rounded-xl border px-4 py-3 text-sm", TONES[tone])}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current text-xs font-bold"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-1 break-words text-muted">{children}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mr-2 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg leading-none text-muted hover:bg-inset hover:text-fg"
        >
          ×
        </button>
      )}
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex animate-fade-in flex-col items-center rounded-xl border border-dashed border-line-strong bg-panel/60 px-6 py-12 text-center">
      <div
        aria-hidden="true"
        className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-inset text-2xl text-subtle"
      >
        {icon}
      </div>
      <h2 className="text-base font-semibold text-fg">{title}</h2>
      {children && <p className="mt-1 max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-3">{action}</div>}
    </div>
  );
}

// ── Key/value row ────────────────────────────────────────────────────────────

export function Field({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs font-semibold uppercase tracking-wider text-subtle">{label}</dt>
      <dd className={cx("mt-0.5 text-sm text-fg", mono ? "break-all font-mono text-xs" : "break-words")}>{children}</dd>
    </div>
  );
}

export const shortHex = (hex: string, head = 6, tail = 4) =>
  hex.length > head + tail + 2 ? `${hex.slice(0, head + 2)}…${hex.slice(-tail)}` : hex;
