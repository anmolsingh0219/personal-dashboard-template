import { useQueryClient } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { BellRing, BookOpen, Briefcase, CalendarClock, Landmark, CalendarPlus, CornerDownLeft, ListTodo, Mail, Plus, RefreshCw, Search, Settings, TrendingUp, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { emit } from "../lib/events";
import { keys, taskApi, useAction, useSettings } from "../lib/queries";
import { parseQuickTask } from "../lib/quickAdd";
import { MIN, relDay, roundUp } from "../lib/time";
import { useCreateBlocks } from "../lib/usePlanner";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  run: () => void;
}

const jump = (id: string) => () => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

export function CommandPalette({ open, onClose, onOpenSettings }: { open: boolean; onClose: () => void; onOpenSettings: () => void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const ref = useRef<HTMLDialogElement>(null);
  const qc = useQueryClient();
  const settings = useSettings().data;
  const createTask = useAction(taskApi.create, [keys.tasks], "Task added");
  const createBlock = useCreateBlocks();

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      ref.current?.showModal();
    } else ref.current?.close();
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const now = Date.now();
    const text = query.trim();
    const dynamic: Command[] = [];
    if (text) {
      const t = parseQuickTask(text, now);
      const extras = [t.due && `due ${relDay(t.due, now).toLowerCase()}`, t.estimateMin && `~${t.estimateMin}m`].filter(Boolean).join(", ");
      dynamic.push({
        id: "add-task",
        label: `Add task “${t.title}”`,
        hint: extras || "Tasks",
        icon: Plus,
        run: () => createTask.mutate({ title: t.title, due: t.due, estimateMin: t.estimateMin }),
      });
      dynamic.push({
        id: "add-block",
        label: `Start “${t.title}” now`,
        hint: `${t.estimateMin ?? settings?.defaultEstimateMin ?? 30}m block`,
        icon: CalendarPlus,
        run: () => {
          const start = Math.floor(now / (5 * MIN)) * 5 * MIN;
          createBlock.mutate({ title: t.title, start, end: roundUp(start + (t.estimateMin ?? settings?.defaultEstimateMin ?? 30) * MIN, 5 * MIN) });
        },
      });
    }
    const fixed: Command[] = [
      { id: "autoplan", label: "Auto-plan today", hint: "Fill free time with tasks due soon", icon: WandSparkles, run: () => emit("dash:autoplan") },
      {
        id: "add-job",
        label: "Add job application",
        icon: Briefcase,
        run: () => {
          jump("jobs")();
          emit("dash:add-job");
        },
      },
      {
        id: "add-holding",
        label: "Add stock holding",
        icon: TrendingUp,
        run: () => {
          jump("stocks")();
          emit("dash:add-holding");
        },
      },
      { id: "go-schedule", label: "Go to schedule", icon: CalendarClock, run: jump("planner") },
      { id: "go-tasks", label: "Go to tasks", icon: ListTodo, run: jump("tasks") },
      { id: "go-email", label: "Go to email", icon: Mail, run: jump("inbox") },
      { id: "go-jobs", label: "Go to applications", icon: Briefcase, run: jump("jobs") },
      { id: "go-stocks", label: "Go to portfolio", hint: "US & India stocks", icon: TrendingUp, run: jump("stocks") },
      { id: "go-alerts", label: "Go to portfolio alerts", icon: BellRing, run: jump("alerts") },
      { id: "go-markets", label: "Go to markets & news", icon: Landmark, run: jump("markets") },
      { id: "go-picks", label: "Go to something to read", icon: BookOpen, run: jump("picks") },
      { id: "refresh", label: "Refresh everything", icon: RefreshCw, run: () => qc.invalidateQueries() },
      { id: "settings", label: "Settings", icon: Settings, run: onOpenSettings },
    ];
    const needle = text.toLowerCase();
    return [...dynamic, ...fixed.filter((c) => !needle || c.label.toLowerCase().includes(needle))];
  }, [query, settings, createTask, createBlock, qc, onOpenSettings]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    // Close the modal now, not in the effect: a panel that mounts or opens a form in the same
    // render can't take focus while the dialog is still open.
    ref.current?.close();
    onClose();
    c.run();
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="mx-auto mt-[12vh] w-[min(560px,calc(100vw-2rem))] rounded-2xl border border-line bg-card p-0 text-ink shadow-2xl backdrop:bg-black/60"
    >
      <div className="flex items-center gap-2 border-b border-line px-4">
        <Search className="size-4 text-muted" aria-hidden />
        <input
          autoFocus
          className="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-muted"
          placeholder="Type a task (~30m @fri) or search commands…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setIndex((i) => Math.min(commands.length - 1, i + 1));
            else if (e.key === "ArrowUp") setIndex((i) => Math.max(0, i - 1));
            else if (e.key === "Enter") run(commands[index]);
            else return;
            e.preventDefault();
          }}
          aria-label="Command"
        />
      </div>
      <ul className="max-h-80 overflow-y-auto p-1.5" role="listbox">
        {commands.map((c, i) => (
          <li key={c.id} role="option" aria-selected={i === index}>
            <button
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${i === index ? "bg-raised text-ink" : "text-ink-2"}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => run(c)}
            >
              <c.icon className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{c.label}</span>
              {c.hint && <span className="shrink-0 text-xs text-muted">{c.hint}</span>}
              {i === index && <CornerDownLeft className="size-3.5 shrink-0 text-muted" aria-hidden />}
            </button>
          </li>
        ))}
      </ul>
    </dialog>
  );
}
