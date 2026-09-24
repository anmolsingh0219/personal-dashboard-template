import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Settings } from "../../shared/types";
import { api } from "../lib/api";
import { disablePush, enablePush, pushState, sendTestPush, type PushState } from "../lib/push";
import { keys, useAction, useGoogleStatus, useSettings } from "../lib/queries";
import { toast } from "../lib/toast";
import { GoogleConnect, Spinner } from "./ui";

const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fromTime = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + (m || 0);
};

const SCOPE_LABELS: [string, string][] = [
  ["gmail.readonly", "Read Gmail"],
  ["calendar.readonly", "Read calendars"],
  ["calendar.events", "Add planner blocks to Calendar"],
  ["auth/tasks", "Google Tasks"],
];

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const qc = useQueryClient();
  const google = useGoogleStatus().data;
  const settings = useSettings().data;
  const [draft, setDraft] = useState<Settings | null>(null);

  useEffect(() => {
    if (open) ref.current?.showModal();
    else {
      ref.current?.close();
      setDraft(null);
    }
  }, [open]);

  // Take a copy of the saved settings when the dialog opens (or once they load).
  useEffect(() => {
    if (open && settings) setDraft((d) => d ?? settings);
  }, [open, settings]);

  const save = useAction((s: Settings) => api.put<Settings>("/settings", s), [keys.settings, keys.email, ["picks"]], "Settings saved");
  const disconnect = useAction(() => api.post("/google/disconnect"), [keys.google, keys.email, keys.tasks, ["calendar"]], "Google disconnected");

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft((d) => d && { ...d, [k]: v });

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(520px,calc(100vw-2rem))] rounded-2xl border border-line bg-card p-0 text-ink shadow-2xl backdrop:bg-black/60"
    >
      <div className="flex items-center border-b border-line px-5 py-3">
        <h2 className="font-semibold">Settings</h2>
        <button className="icon-btn ml-auto" onClick={onClose} aria-label="Close">
          <X className="size-4" />
        </button>
      </div>

      <div className="max-h-[70vh] space-y-6 overflow-y-auto px-5 py-4">
        <Notifications open={open} />

        <section className="space-y-2">
          <h3 className="text-sm font-medium text-ink-2">Google account</h3>
          {google?.connected ? (
            <>
              <p className="text-sm">
                Connected as <span className="font-medium">{google.email}</span>
              </p>
              <ul className="space-y-0.5 text-xs text-muted">
                {SCOPE_LABELS.map(([needle, label]) => {
                  const ok = google.scopes.some((s) => s.includes(needle));
                  return (
                    <li key={needle} className={ok ? "text-ink-2" : "text-warn"}>
                      {ok ? "✓" : "✗"} {label}
                    </li>
                  );
                })}
              </ul>
              <div className="flex gap-2 pt-1">
                <GoogleConnect label="Reconnect" />
                <button
                  className="btn-ghost"
                  onClick={() => {
                    disconnect.mutate(undefined, { onSuccess: () => qc.removeQueries({ queryKey: keys.email }) });
                  }}
                >
                  Disconnect
                </button>
              </div>
            </>
          ) : (
            <GoogleConnect configured={google?.configured} />
          )}
        </section>

        {draft && (
          <>
            <section className="space-y-3">
              <h3 className="text-sm font-medium text-ink-2">Schedule</h3>
              <div className="grid grid-cols-3 gap-2">
                <label className="text-xs text-muted">
                  Day starts
                  <input type="time" className="input mt-1" value={toTime(draft.dayStartMin)} onChange={(e) => set("dayStartMin", fromTime(e.target.value))} />
                </label>
                <label className="text-xs text-muted">
                  Day ends
                  <input type="time" className="input mt-1" value={toTime(draft.dayEndMin)} onChange={(e) => set("dayEndMin", fromTime(e.target.value))} />
                </label>
                <label className="text-xs text-muted">
                  Default task length
                  <select className="input mt-1" value={draft.defaultEstimateMin} onChange={(e) => set("defaultEstimateMin", Number(e.target.value))}>
                    {[15, 30, 45, 60, 90].map((m) => (
                      <option key={m} value={m}>
                        {m} min
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 accent-accent" checked={draft.mirrorCalendar} onChange={(e) => set("mirrorCalendar", e.target.checked)} />
                <span>
                  Also add planner blocks to Google Calendar
                  <span className="block text-xs text-muted">So they show up on your phone with a notification when each block starts.</span>
                </span>
              </label>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-medium text-ink-2">Email</h3>
              <label className="block text-xs text-muted">
                Other addresses that are you (comma separated)
                <input className="input mt-1" placeholder="you@school.edu, first.last@work.com" value={draft.emailAliases} onChange={(e) => set("emailAliases", e.target.value)} />
              </label>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-medium text-ink-2">Reading picks</h3>
              <label className="block text-xs text-muted">
                Topics you care about (comma separated) — boosts matching Hacker News stories
                <input className="input mt-1" placeholder="ai, startups, finance, rust" value={draft.readInterests} onChange={(e) => set("readInterests", e.target.value)} />
              </label>
            </section>
          </>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-primary"
          disabled={!draft || draft.dayEndMin <= draft.dayStartMin}
          onClick={() => draft && save.mutate(draft, { onSuccess: onClose })}
        >
          Save
        </button>
      </div>
    </dialog>
  );
}

const PUSH_NOTES: Record<PushState, string> = {
  unsupported: "This browser can't receive notifications.",
  "needs-install": "On iPhone, add the dashboard to your Home Screen first (Share → Add to Home Screen), then open it from there and turn alerts on.",
  denied: "Notifications are blocked for this site. On iPhone, allow them in Settings → Notifications → Dashboard; in a desktop browser, use the site settings by the address bar.",
  off: "Get a notification at 7 PM the day before and 8 AM on the day a task or application step is due.",
  on: "On for this device: 7 PM the day before and 8 AM on the day a task or application step is due.",
};

/** Deadline alerts for this device; takes effect immediately, separate from Save. */
function Notifications({ open }: { open: boolean }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) pushState().then(setState, () => setState("unsupported"));
  }, [open]);

  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      await action();
      if (done) toast(done);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setState(await pushState().catch(() => "unsupported" as const));
      setBusy(false);
    }
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-ink-2">Deadline alerts</h3>
      <p className="text-xs text-muted">{state ? PUSH_NOTES[state] : "Checking…"}</p>
      {(state === "off" || state === "on") && (
        <div className="flex gap-2">
          {state === "off" ? (
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await enablePush();
                  await sendTestPush();
                }, "Alerts on. A test notification is on its way.")
              }
            >
              {busy && <Spinner className="size-3.5" />} Turn on for this device
            </button>
          ) : (
            <>
              <button
                className="btn-ghost border border-line"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await sendTestPush();
                    if (!r.sent) throw new Error(r.failed ? "The push service refused the test. Try turning alerts off and on." : "No devices are subscribed.");
                  }, "Test sent")
                }
              >
                Send a test
              </button>
              <button className="btn-ghost" disabled={busy} onClick={() => run(disablePush, "Alerts off for this device")}>
                Turn off
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
