import type { NewBlock } from "../../shared/types";
import { MIN, roundUp } from "./time";

// Pure scheduling math for the day planner: free-slot search, auto-planning tasks into
// the gaps between calendar events, and side-by-side layout of overlapping items.

export interface Interval {
  start: number;
  end: number;
}

export function mergeIntervals(items: Interval[]): Interval[] {
  const sorted = items.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out.at(-1);
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ start: i.start, end: i.end });
  }
  return out;
}

export function freeSlots(busy: Interval[], from: number, to: number): Interval[] {
  const out: Interval[] = [];
  let cursor = from;
  for (const b of mergeIntervals(busy)) {
    if (b.end <= cursor) continue;
    if (b.start >= to) break;
    if (b.start > cursor) out.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < to) out.push({ start: cursor, end: to });
  return out;
}

/** First gap of at least `duration` starting on a 15-minute boundary. */
export function nextFreeSlot(busy: Interval[], duration: number, from: number, to: number): Interval | null {
  for (const slot of freeSlots(busy, from, to)) {
    const start = roundUp(slot.start);
    if (start + duration <= slot.end) return { start, end: start + duration };
  }
  return null;
}

export interface PlannableTask {
  key: string;
  title: string;
  estimateMin: number | null;
}

/**
 * Greedily place tasks (already in priority order) into free time, leaving a short
 * buffer after each block. Tasks that don't fit are skipped, not split.
 */
export function autoPlan(tasks: PlannableTask[], busy: Interval[], from: number, to: number, defaultMin = 30, bufferMin = 5): NewBlock[] {
  const taken = [...busy];
  const out: NewBlock[] = [];
  for (const task of tasks) {
    const duration = (task.estimateMin ?? defaultMin) * MIN;
    const slot = nextFreeSlot(taken, duration + bufferMin * MIN, from, to);
    if (!slot) continue;
    const block = { title: task.title, start: slot.start, end: slot.start + duration, taskKey: task.key };
    out.push(block);
    taken.push({ start: block.start, end: block.end + bufferMin * MIN });
  }
  return out;
}

export interface Positioned<T> {
  item: T;
  column: number;
  columns: number;
}

/** Calendar-style layout: overlapping items share the width in columns. */
export function layoutColumns<T extends Interval>(items: T[]): Positioned<T>[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Positioned<T>[] = [];
  let cluster: Positioned<T>[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    for (const p of cluster) p.columns = colEnds.length;
    out.push(...cluster);
    cluster = [];
    colEnds = [];
  };

  for (const item of sorted) {
    if (item.start >= clusterEnd) flush();
    let column = colEnds.findIndex((end) => end <= item.start);
    if (column === -1) {
      column = colEnds.length;
      colEnds.push(item.end);
    } else colEnds[column] = item.end;
    cluster.push({ item, column, columns: 0 });
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();
  return out;
}
