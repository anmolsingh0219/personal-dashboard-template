import { CalendarClock, Check, ExternalLink, Minus, Plus, Trash2, Video, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FormEvent } from "react";
import type { Block, CalendarEvent } from "../../shared/types";
import { useDashEvent } from "../lib/events";
import { autoPlan, layoutColumns, nextFreeSlot } from "../lib/plan";
import { blockApi, useAction, useSettings, useTasks } from "../lib/queries";
import { addDays, atMinute, daysUntil, fmtDuration, fmtTime, MIN, minuteOfDay, roundUp, startOfDay, ymd } from "../lib/time";
import { toast } from "../lib/toast";
import { PLAN_KEYS, useCreateBlocks, useDayData } from "../lib/usePlanner";
import { Card, ErrorNote } from "./ui";

export const DRAG_MIME = "application/x-dashboard";
export type DragPayload = { type: "task"; key: string; title: string; estimateMin: number | null } | { type: "block"; id: string; duration: number; grabOffsetMin: number };

const PX_PER_MIN = 1.1;
const SNAP = 15;
const DURATIONS = [15, 30, 45, 60, 90, 120, 180];

type Item = ({ kind: "event"; event: CalendarEvent } | { kind: "block"; block: Block }) & { start: number; end: number; id: string };

export function Planner({ now }: { now: number }) {
  const [dayOffset, setDayOffset] = useState(0);
  const today = startOfDay(now);
  const day = addDays(today, dayOffset);
  const settings = useSettings().data;
  const { events, blockList, busy, calendar, blocks } = useDayData(day);
  const tasks = useTasks().data?.tasks ?? [];

  const create = useCreateBlocks();
  const update = useAction(blockApi.update, PLAN_KEYS);
  const remove = useAction(blockApi.remove, PLAN_KEYS);

  const [draft, setDraft] = useState<{ minute: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hoverMin, setHoverMin] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const dayStartMin = settings?.dayStartMin ?? 7 * 60;
  const dayEndMin = settings?.dayEndMin ?? 23 * 60;
  const timed = events.filter((e) => !e.allDay);
  const allDay = events.filter((e) => e.allDay);

  // Visible range: the configured day, stretched to fit anything scheduled outside it.
  const [rangeStart, rangeEnd] = useMemo(() => {
    let lo = dayStartMin;
    let hi = dayEndMin;
    for (const i of [...timed, ...blockList]) {
      lo = Math.min(lo, i.start <= day ? 0 : minuteOfDay(i.start));
      hi = Math.max(hi, i.end >= addDays(day, 1) ? 1440 : minuteOfDay(i.end));
    }
    return [Math.floor(lo / 60) * 60, Math.min(1440, Math.ceil(hi / 60) * 60)];
  }, [timed, blockList, day, dayStartMin, dayEndMin]);

  const items: Item[] = [
    ...timed.map((event) => ({ kind: "event" as const, event, start: event.start, end: event.end, id: event.id })),
    ...blockList.map((block) => ({ kind: "block" as const, block, start: block.start, end: block.end, id: block.id })),
  ];
  const laidOut = layoutColumns(items);
  const top = (t: number) => (Math.max(0, (t - day) / MIN) - rangeStart) * PX_PER_MIN;

  // Keep "now" in view on first load.
  useEffect(() => {
    if (dayOffset !== 0 || !scrollRef.current) return;
    const y = (minuteOfDay(Date.now()) - rangeStart) * PX_PER_MIN;
    scrollRef.current.scrollTop = Math.max(0, y - 120);
  }, [dayOffset, rangeStart]);

  const minuteAt = (clientY: number) => {
    const rect = gridRef.current!.getBoundingClientRect();
    const raw = rangeStart + (clientY - rect.top) / PX_PER_MIN;
    return Math.max(rangeStart, Math.min(rangeEnd - SNAP, Math.floor(raw / SNAP) * SNAP));
  };

  const busyExcept = (id?: string) => [...timed, ...blockList.filter((b) => !b.done && b.id !== id)].map(({ start, end }) => ({ start, end }));

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setHoverMin(null);
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    const payload = JSON.parse(raw) as DragPayload;
    if (payload.type === "task") {
      const start = atMinute(day, minuteAt(e.clientY));
      const duration = (payload.estimateMin ?? settings?.defaultEstimateMin ?? 30) * MIN;
      create.mutate({ title: payload.title, start, end: start + duration, taskKey: payload.key });
    } else {
      const start = atMinute(day, Math.max(rangeStart, minuteAt(e.clientY) - Math.floor(payload.grabOffsetMin / SNAP) * SNAP));
      update.mutate({ id: payload.id, start, end: start + payload.duration });
    }
  }

  function runAutoPlan() {
    const scheduled = new Set(blockList.map((b) => b.taskKey).filter(Boolean));
    const candidates = tasks.filter((t) => !t.done && !scheduled.has(t.key) && t.due && daysUntil(t.due, day) <= 3);
    const from = dayOffset === 0 ? roundUp(now) : atMinute(day, dayStartMin);
    const planned = autoPlan(candidates, busy, from, atMinute(day, dayEndMin), settings?.defaultEstimateMin ?? 30);
    if (candidates.length === 0) return toast("No unscheduled tasks due in the next 3 days. Drag tasks in by hand.");
    if (planned.length === 0) return toast("No free time left that fits your tasks.", "error");
    create.mutate(planned, {
      onSuccess: () => toast(`Planned ${planned.length} of ${candidates.length} task${candidates.length > 1 ? "s" : ""}${planned.length < candidates.length ? " (the rest didn't fit)" : ""}`),
    });
  }

  useDashEvent("dash:autoplan", runAutoPlan);

  function reschedule(b: Block) {
    const slot = nextFreeSlot(busyExcept(b.id), b.end - b.start, roundUp(now), atMinute(today, dayEndMin));
    if (!slot) return toast("No free slot left today.", "error");
    update.mutate({ id: b.id, start: slot.start, end: slot.end }, { onSuccess: () => toast(`Moved to ${fmtTime(slot.start)}`) });
  }

  const nowMin = minuteOfDay(now);
  const hours = Array.from({ length: (rangeEnd - rangeStart) / 60 + 1 }, (_, i) => rangeStart + i * 60);
  const plannedMin = blockList.reduce((sum, b) => sum + (b.end - b.start) / MIN, 0);

  return (
    <Card
      id="planner"
      title="Schedule"
      icon={CalendarClock}
      className="flex flex-col lg:sticky lg:top-3 lg:self-start xl:static xl:min-h-0 xl:self-stretch"
      bodyClassName="flex min-h-0 flex-1 flex-col"
      actions={
        <>
          <div className="mr-1 flex rounded-lg bg-raised p-0.5 text-xs">
            {["Today", "Tomorrow"].map((label, i) => (
              <button
                key={label}
                onClick={() => setDayOffset(i)}
                className={`rounded-md px-2 py-1 font-medium transition ${dayOffset === i ? "bg-card text-ink shadow" : "text-muted hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <button className="icon-btn" onClick={runAutoPlan} title="Auto-plan tasks due soon into free time" aria-label="Auto-plan">
            <WandSparkles className="size-4" />
          </button>
          <button
            className="icon-btn"
            title="New block"
            aria-label="New block"
            onClick={() => setDraft({ minute: dayOffset === 0 ? Math.min(rangeEnd - 30, minuteOfDay(roundUp(now))) : dayStartMin })}
          >
            <Plus className="size-4" />
          </button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-4 pb-2 text-xs text-muted">
        <span>{new Date(day).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</span>
        <span aria-hidden>·</span>
        <span className="tabular">{plannedMin ? `${fmtDuration(plannedMin * MIN)} planned` : "Nothing planned yet"}</span>
        {calendar.data?.source === "claude" && calendar.data.updatedAt && (
          <span className="ml-auto">Calendar via Claude · {fmtTime(calendar.data.updatedAt)}</span>
        )}
        {calendar.data?.source === null && <span className="ml-auto">Calendar not connected</span>}
      </div>

      {draft && <BlockForm day={day} minute={draft.minute} defaultMin={settings?.defaultEstimateMin ?? 30} onClose={() => setDraft(null)} onCreate={(b) => create.mutate(b)} />}

      {allDay.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-2">
          {allDay.map((e) => (
            <span key={e.id} className="chip bg-violet-soft text-ink" title={e.calendar}>
              {e.title}
            </span>
          ))}
        </div>
      )}

      {(calendar.error || blocks.error) && (
        <div className="px-4 pb-2">
          <ErrorNote error={calendar.error ?? blocks.error} />
        </div>
      )}

      <div ref={scrollRef} className="relative max-h-[70vh] min-h-64 flex-1 overflow-y-auto px-4 pb-4 lg:max-h-[calc(100dvh-9rem)] xl:max-h-none xl:min-h-0">
        <div
          ref={gridRef}
          className="relative ml-12 cursor-crosshair"
          style={{ height: (rangeEnd - rangeStart) * PX_PER_MIN }}
          onClick={(e) => {
            if (e.target === gridRef.current) setDraft({ minute: minuteAt(e.clientY) });
            setSelected(null);
          }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setHoverMin(minuteAt(e.clientY));
          }}
          onDragLeave={() => setHoverMin(null)}
          onDrop={onDrop}
        >
          {hours.map((m) => (
            <div key={m} className="pointer-events-none absolute inset-x-0 border-t border-line" style={{ top: (m - rangeStart) * PX_PER_MIN }}>
              <span className="absolute -top-2 -left-12 w-10 text-right text-[10px] text-muted tabular">
                {m === 1440 ? "" : new Date(atMinute(day, m)).toLocaleTimeString([], { hour: "numeric" })}
              </span>
            </div>
          ))}

          {hoverMin !== null && (
            <div className="pointer-events-none absolute inset-x-0 rounded-md border border-dashed border-accent/70 bg-accent-soft" style={{ top: (hoverMin - rangeStart) * PX_PER_MIN, height: 30 * PX_PER_MIN }}>
              <span className="px-2 text-[11px] text-accent">{fmtTime(atMinute(day, hoverMin))}</span>
            </div>
          )}

          {laidOut.map(({ item, column, columns }) => {
            const height = Math.max(20, ((item.end - item.start) / MIN) * PX_PER_MIN - 2);
            const style = { top: top(item.start) + 1, height, left: `calc(${(column / columns) * 100}% + 2px)`, width: `calc(${100 / columns}% - 4px)` };
            return item.kind === "event" ? (
              <EventItem key={item.id} event={item.event} style={style} compact={height < 36} />
            ) : (
              <BlockItem
                key={item.id}
                block={item.block}
                style={style}
                compact={height < 36}
                now={now}
                selected={selected === item.id}
                onSelect={() => setSelected(selected === item.id ? null : item.id)}
                onToggleDone={() => update.mutate({ id: item.block.id, done: !item.block.done })}
                onResize={(deltaMin) => {
                  const end = Math.max(item.block.start + SNAP * MIN, item.block.end + deltaMin * MIN);
                  update.mutate({ id: item.block.id, end });
                }}
                onDelete={() => remove.mutate(item.block.id)}
                onReschedule={() => reschedule(item.block)}
              />
            );
          })}

          {dayOffset === 0 && nowMin >= rangeStart && nowMin <= rangeEnd && (
            <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-bad" style={{ top: (nowMin - rangeStart) * PX_PER_MIN }}>
              <span className="absolute -top-[5px] -left-1.5 size-2 rounded-full bg-bad" />
            </div>
          )}
        </div>
      </div>
      <p className="border-t border-line px-4 py-2 text-[11px] text-muted">Drag tasks onto the timeline · click empty time to add a block · drag blocks to move them</p>
    </Card>
  );
}

function EventItem({ event, style, compact }: { event: CalendarEvent; style: CSSProperties; compact: boolean }) {
  return (
    <div
      className="group absolute overflow-hidden rounded-md border-l-2 border-violet bg-violet-soft px-2 py-1 text-xs"
      style={style}
      title={`${event.title}\n${fmtTime(event.start)} – ${fmtTime(event.end)} · ${event.calendar}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-1">
        <p className="min-w-0 flex-1 truncate font-medium text-ink">{event.title}</p>
        {event.meetLink && (
          <a href={event.meetLink} target="_blank" rel="noreferrer" className="text-violet hover:text-ink" aria-label="Join video call">
            <Video className="size-3.5" />
          </a>
        )}
        {event.htmlLink && (
          <a href={event.htmlLink} target="_blank" rel="noreferrer" className="opacity-0 text-muted transition group-hover:opacity-100 hover:text-ink" aria-label="Open in Google Calendar">
            <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>
      {!compact && (
        <p className="truncate text-muted tabular">
          {fmtTime(event.start)} – {fmtTime(event.end)}
          {event.location ? ` · ${event.location}` : ""}
        </p>
      )}
    </div>
  );
}

function BlockItem(props: {
  block: Block;
  style: CSSProperties;
  compact: boolean;
  now: number;
  selected: boolean;
  onSelect: () => void;
  onToggleDone: () => void;
  onResize: (deltaMin: number) => void;
  onDelete: () => void;
  onReschedule: () => void;
}) {
  const { block, style, compact, now, selected } = props;
  const missed = !block.done && block.end < now;
  const active = !block.done && block.start <= now && now < block.end;
  const tone = block.done ? "border-muted bg-raised/60 opacity-60" : missed ? "border-warn bg-warn/10" : "border-accent bg-accent-soft";

  return (
    <div
      className={`absolute cursor-grab overflow-hidden rounded-md border-l-2 px-2 py-1 text-xs active:cursor-grabbing ${tone} ${active ? "ring-1 ring-accent/60" : ""} ${selected ? "z-20 overflow-visible ring-1 ring-ink-2/50" : ""}`}
      style={style}
      draggable
      onDragStart={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const payload: DragPayload = { type: "block", id: block.id, duration: block.end - block.start, grabOffsetMin: (e.clientY - rect.top) / PX_PER_MIN };
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={(e) => {
        e.stopPropagation();
        props.onSelect();
      }}
    >
      <div className="flex items-start gap-1">
        <button
          className={`mt-px flex size-3.5 shrink-0 items-center justify-center rounded-full border ${block.done ? "border-good bg-good text-page" : "border-ink-2/60 hover:border-ink"}`}
          onClick={(e) => {
            e.stopPropagation();
            props.onToggleDone();
          }}
          aria-label={block.done ? "Mark not done" : "Mark done"}
        >
          {block.done && <Check className="size-2.5" strokeWidth={3} />}
        </button>
        <p className={`min-w-0 flex-1 truncate font-medium ${block.done ? "line-through" : "text-ink"}`}>{block.title}</p>
        {missed && (
          <button
            className="shrink-0 rounded bg-warn/20 px-1 text-[10px] font-semibold text-warn hover:bg-warn/30"
            onClick={(e) => {
              e.stopPropagation();
              props.onReschedule();
            }}
          >
            Missed · move
          </button>
        )}
      </div>
      {!compact && (
        <p className="truncate text-muted tabular">
          {fmtTime(block.start)} – {fmtTime(block.end)} · {fmtDuration(block.end - block.start)}
          {block.mirrored ? " · on calendar" : ""}
        </p>
      )}
      {selected && (
        <div className="absolute right-1 bottom-1 flex gap-0.5 rounded-md bg-card/95 p-0.5 shadow-lg" onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn size-6" onClick={() => props.onResize(-SNAP)} aria-label="Shorten 15 minutes" title="−15m">
            <Minus className="size-3.5" />
          </button>
          <button className="icon-btn size-6" onClick={() => props.onResize(SNAP)} aria-label="Extend 15 minutes" title="+15m">
            <Plus className="size-3.5" />
          </button>
          <button className="icon-btn size-6 hover:text-bad" onClick={props.onDelete} aria-label="Delete block" title="Delete">
            <Trash2 className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function BlockForm({ day, minute, defaultMin, onClose, onCreate }: { day: number; minute: number; defaultMin: number; onClose: () => void; onCreate: (b: { title: string; start: number; end: number }) => void }) {
  const [title, setTitle] = useState("");
  const [time, setTime] = useState(`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
  const [duration, setDuration] = useState(DURATIONS.includes(defaultMin) ? defaultMin : 30);

  function submit(e: FormEvent) {
    e.preventDefault();
    const [h, m] = time.split(":").map(Number);
    if (!title.trim() || Number.isNaN(h)) return;
    const start = atMinute(day, h * 60 + m);
    onCreate({ title: title.trim(), start, end: start + duration * MIN });
    onClose();
  }

  return (
    <form onSubmit={submit} className="mx-4 mb-3 flex flex-wrap gap-2 rounded-xl border border-line bg-raised/50 p-2" aria-label={`New block on ${ymd(day)}`}>
      <input autoFocus className="input min-w-40 flex-1" placeholder="What are you doing?" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onClose()} />
      <input type="time" className="input w-28" value={time} onChange={(e) => setTime(e.target.value)} step={900} aria-label="Start time" />
      <select className="input w-24" value={duration} onChange={(e) => setDuration(Number(e.target.value))} aria-label="Duration">
        {DURATIONS.map((d) => (
          <option key={d} value={d}>
            {fmtDuration(d * MIN)}
          </option>
        ))}
      </select>
      <button className="btn-primary" disabled={!title.trim()}>
        Add
      </button>
      <button type="button" className="btn-ghost" onClick={onClose}>
        Cancel
      </button>
    </form>
  );
}
