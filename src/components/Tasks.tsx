import { useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Check, ListTodo, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { Task, TasksResponse } from "../../shared/types";
import { parseQuickTask } from "../lib/quickAdd";
import { keys, taskApi, useAction, useGoogleStatus, useTasks } from "../lib/queries";
import { daysUntil, relDay } from "../lib/time";
import { useScheduleTask } from "../lib/usePlanner";
import { DRAG_MIME, type DragPayload } from "./Planner";
import { Card, Empty, ErrorNote, Loading, RefreshButton } from "./ui";

const ESTIMATES = [15, 30, 45, 60, 90, 120];

export function Tasks({ now }: { now: number }) {
  const qc = useQueryClient();
  const tasks = useTasks();
  const google = useGoogleStatus().data;
  const schedule = useScheduleTask(now);
  const [input, setInput] = useState("");
  const [showLater, setShowLater] = useState(false);

  const create = useAction(taskApi.create, [keys.tasks]);
  const update = useAction(taskApi.update, [keys.tasks]);
  const remove = useAction(taskApi.remove, [keys.tasks]);

  const parsed = parseQuickTask(input, now);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!parsed.title) return;
    create.mutate({ title: parsed.title, due: parsed.due, estimateMin: parsed.estimateMin });
    setInput("");
  }

  function complete(task: Task) {
    // Optimistic: drop it from the list right away.
    qc.setQueryData<TasksResponse>(keys.tasks, (old) => old && { ...old, tasks: old.tasks.filter((t) => t.key !== task.key) });
    update.mutate({ key: task.key, done: true });
  }

  const list = tasks.data?.tasks ?? [];
  const soon = list.filter((t) => t.due && daysUntil(t.due, now) <= 1);
  const later = list.filter((t) => !t.due || daysUntil(t.due, now) > 1);
  const visible = showLater || soon.length === 0 ? [...soon, ...later] : soon;

  return (
    <Card
      id="tasks"
      title="Tasks"
      icon={ListTodo}
      count={soon.length}
      fill
      className="xl:flex-1"
      actions={<RefreshButton onClick={() => tasks.refetch()} busy={tasks.isFetching} />}
      toolbar={
        <>
          <form onSubmit={submit} className="mb-2">
            <input
              className="input"
              placeholder="Add a task…  ~45m for length, @fri for due date"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              aria-label="New task"
            />
            {(parsed.due || parsed.estimateMin) && (
              <div className="mt-1.5 flex gap-1.5 text-xs text-muted">
                {parsed.due && <span className="chip">Due {relDay(parsed.due, now)}</span>}
                {parsed.estimateMin && <span className="chip">~{parsed.estimateMin}m</span>}
                <span className="ml-auto">{google?.connected ? "→ Google Tasks" : "→ dashboard only"}</span>
              </div>
            )}
          </form>
          {tasks.data?.googleError && (
            <div className="mb-2">
              <ErrorNote error={`Google Tasks: ${tasks.data.googleError}`} />
            </div>
          )}
        </>
      }
    >
      {tasks.isPending ? (
        <Loading />
      ) : tasks.error ? (
        <ErrorNote error={tasks.error} />
      ) : list.length === 0 ? (
        <Empty>No open tasks. Nice.</Empty>
      ) : (
        <>
          <ul className="-mx-2 max-h-[420px] overflow-y-auto xl:max-h-none xl:overflow-visible">
            {visible.map((t) => (
              <TaskRow
                key={t.key}
                task={t}
                now={now}
                onComplete={() => complete(t)}
                onEstimate={(estimateMin) => update.mutate({ key: t.key, estimateMin })}
                onSchedule={() => schedule(t)}
                onDelete={() => remove.mutate(t.key)}
              />
            ))}
          </ul>
          {soon.length > 0 && later.length > 0 && (
            <button className="mt-2 text-xs text-muted hover:text-ink" onClick={() => setShowLater(!showLater)}>
              {showLater ? "Show only due soon" : `Show ${later.length} later / undated`}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

function TaskRow({ task, now, onComplete, onEstimate, onSchedule, onDelete }: { task: Task; now: number; onComplete: () => void; onEstimate: (m: number) => void; onSchedule: () => void; onDelete: () => void }) {
  const due = task.due ? daysUntil(task.due, now) : null;
  const dueTone = due === null ? "" : due < 0 ? "text-bad" : due === 0 ? "text-warn" : "text-muted";
  const nextEstimate = ESTIMATES[(ESTIMATES.indexOf(task.estimateMin ?? 30) + 1) % ESTIMATES.length];

  return (
    <li
      className="group flex cursor-grab items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-raised/60 active:cursor-grabbing"
      draggable
      onDragStart={(e) => {
        const payload: DragPayload = { type: "task", key: task.key, title: task.title, estimateMin: task.estimateMin };
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
        e.dataTransfer.effectAllowed = "copy";
      }}
    >
      <button className="flex size-4 shrink-0 items-center justify-center rounded-full border border-ink-2/50 text-transparent transition hover:border-good hover:text-good" onClick={onComplete} aria-label={`Complete ${task.title}`}>
        <Check className="size-3" strokeWidth={3} />
      </button>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm text-ink sm:truncate" title={task.notes ?? task.title}>
          {task.title}
        </p>
        {task.list && task.list !== "My Tasks" && <p className="truncate text-[11px] text-muted">{task.list}</p>}
      </div>
      {task.due && <span className={`text-xs whitespace-nowrap ${dueTone}`}>{relDay(task.due, now)}</span>}
      <button className="chip tabular hover:text-ink" onClick={() => onEstimate(nextEstimate)} title="Estimated time (click to change)">
        {task.estimateMin ? `${task.estimateMin}m` : "—"}
      </button>
      <div className="flex opacity-100 transition [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">
        <button className="icon-btn" onClick={onSchedule} title="Put in the next free slot today" aria-label="Schedule today">
          <CalendarPlus className="size-3.5" />
        </button>
        <button className="icon-btn hover:text-bad" onClick={onDelete} title="Delete" aria-label="Delete task">
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <span className={`size-1.5 shrink-0 rounded-full ${task.source === "google" ? "bg-accent" : "bg-muted"}`} title={task.source === "google" ? "Google Tasks" : "Dashboard only"} />
    </li>
  );
}
