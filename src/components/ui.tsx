import type { LucideIcon } from "lucide-react";
import { LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { ApiError } from "../lib/api";

/**
 * A dashboard panel. On wide screens (xl) the dashboard fits the viewport: panels with
 * `fill` stretch to their share of the column and scroll their body; `toolbar` content
 * (inputs, tabs, filters) stays put above the scrolling part.
 */
export function Card({
  id,
  title,
  icon: Icon,
  count,
  actions,
  toolbar,
  children,
  fill = false,
  className = "",
  bodyClassName = "px-4 pb-4",
}: {
  id?: string;
  title: string;
  icon: LucideIcon;
  count?: number | null;
  actions?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  fill?: boolean;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section id={id} className={`scroll-mt-3 rounded-2xl border border-line bg-card ${fill ? "xl:flex xl:min-h-44 xl:flex-col" : ""} ${className}`}>
      <header className="flex min-h-11 min-w-0 shrink-0 items-center gap-2 px-4 pt-2.5 pb-1.5">
        <Icon className="size-4 text-muted" aria-hidden />
        <h2 className="truncate text-[13px] font-semibold text-ink-2">{title}</h2>
        {count != null && count > 0 && <span className="chip tabular">{count}</span>}
        <div className="ml-auto flex items-center gap-0.5">{actions}</div>
      </header>
      {toolbar && <div className="relative z-20 shrink-0 px-4">{toolbar}</div>}
      <div className={`${bodyClassName} ${fill ? "xl:min-h-0 xl:flex-1 xl:overflow-y-auto" : ""}`}>{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2 py-1" aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-lg bg-raised/60" />
      ))}
    </div>
  );
}

export function ErrorNote({ error, children }: { error: unknown; children?: ReactNode }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex gap-2 rounded-lg border border-bad/30 bg-bad/5 px-3 py-2.5 text-sm text-ink-2">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden />
      <div className="min-w-0 space-y-1">
        <p className="break-words">{message}</p>
        {children}
      </div>
    </div>
  );
}

export const isCode = (error: unknown, code: string) => error instanceof ApiError && error.code === code;

export function Spinner({ className = "size-4" }: { className?: string }) {
  return <LoaderCircle className={`${className} animate-spin`} aria-hidden />;
}

export function RefreshButton({ onClick, busy, label = "Refresh" }: { onClick: () => void; busy?: boolean; label?: string }) {
  return (
    <button className="icon-btn" onClick={onClick} title={label} aria-label={label} disabled={busy}>
      {busy ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" aria-hidden />}
    </button>
  );
}

export function GoogleConnect({ label = "Connect Google", configured = true }: { label?: string; configured?: boolean }) {
  if (!configured) {
    return <p className="text-sm text-muted">Add your Google OAuth client ID and secret first (README → Google setup).</p>;
  }
  return (
    <a href="/api/google/connect" className="btn-primary">
      {label}
    </a>
  );
}
