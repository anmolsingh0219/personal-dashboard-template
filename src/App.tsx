import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ChartHost } from "./components/ChartHost";
import { CommandPalette } from "./components/CommandPalette";
import { Inbox } from "./components/Inbox";
import { Jobs } from "./components/Jobs";
import { Markets } from "./components/Markets";
import { NowStrip } from "./components/NowStrip";
import { Picks } from "./components/Picks";
import { Planner } from "./components/Planner";
import { PortfolioAlerts } from "./components/PortfolioAlerts";
import { SettingsDialog } from "./components/SettingsDialog";
import { Stocks } from "./components/Stocks";
import { Tasks } from "./components/Tasks";
import { dismissToast, toast, useToasts } from "./lib/toast";
import { useNow } from "./lib/useNow";

const OAUTH_ERRORS: Record<string, string> = {
  access_denied: "Google access was denied. If your school or company blocked it, see README → “If your Google Workspace blocks Gmail”.",
  admin_policy_enforced: "Your Google Workspace admin blocks this app. See README → “If your Google Workspace blocks Gmail”.",
  state_mismatch: "Google sign-in expired. Try connecting again.",
  no_refresh_token: "Google didn't return offline access. Remove the app at myaccount.google.com/permissions and connect again.",
};

export default function App() {
  const now = useNow();
  const qc = useQueryClient();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = useCallback(() => setSettingsOpen(true), []);

  // Result of the Google OAuth redirect.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const result = params.get("google");
    if (!result) return;
    if (result === "connected") {
      toast("Google connected");
      qc.invalidateQueries();
    } else {
      const reason = params.get("reason") ?? "";
      toast(OAUTH_ERRORS[reason] ?? `Google connection failed (${reason}).`, "error");
    }
    history.replaceState(null, "", location.pathname);
  }, [qc]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    // Wide screens: everything on one screen, each panel scrolling on its own.
    <div className="flex min-h-dvh flex-col gap-3 p-2 sm:p-3 xl:h-dvh xl:overflow-hidden">
      <NowStrip now={now} onOpenPalette={() => setPaletteOpen(true)} onOpenSettings={openSettings} />

      <main className="grid grid-cols-1 items-start gap-3 *:min-w-0 lg:grid-cols-3 xl:min-h-0 xl:flex-1 xl:grid-cols-4 xl:items-stretch">
        <Planner now={now} />
        <div className="flex flex-col gap-3 xl:min-h-0">
          <Tasks now={now} />
          <Inbox now={now} />
        </div>
        <div className="flex flex-col gap-3 xl:min-h-0">
          <Markets now={now} />
          <Stocks now={now} />
        </div>
        <div className="flex flex-col gap-3 xl:min-h-0">
          <Jobs now={now} />
          <Picks now={now} />
          <PortfolioAlerts now={now} />
        </div>
      </main>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onOpenSettings={openSettings} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ChartHost />
      <Toasts />
    </div>
  );
}

function Toasts() {
  const toasts = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-4 sm:items-end" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex max-w-sm items-start gap-2 rounded-xl border px-3.5 py-2.5 text-sm shadow-xl ${t.kind === "error" ? "border-bad/40 bg-[#2a1616] text-ink" : "border-line bg-raised text-ink"}`}
        >
          <span className="flex-1">{t.message}</span>
          <button className="text-muted hover:text-ink" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
