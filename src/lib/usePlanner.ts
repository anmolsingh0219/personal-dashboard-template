import type { NewBlock, Task } from "../../shared/types";
import { nextFreeSlot, type Interval } from "./plan";
import { blockApi, useAction, useBlocks, useCalendar, useSettings } from "./queries";
import { addDays, atMinute, fmtTime, MIN, roundUp, startOfDay } from "./time";
import { toast } from "./toast";

export const PLAN_KEYS = [["blocks"], ["calendar"]];

/** Calendar events + planner blocks for one local day. */
export function useDayData(day: number) {
  const from = day;
  const to = addDays(day, 1);
  const calendar = useCalendar(from, to);
  const blocks = useBlocks(from, to);
  const events = calendar.data?.events ?? [];
  const blockList = blocks.data ?? [];
  const busy: Interval[] = [...events.filter((e) => !e.allDay), ...blockList.filter((b) => !b.done)].map(({ start, end }) => ({ start, end }));
  return { from, to, calendar, blocks, events, blockList, busy };
}

export function useCreateBlocks() {
  return useAction((b: NewBlock | NewBlock[]) => blockApi.create(b), PLAN_KEYS);
}

/** "Schedule" a task into the next free slot today. */
export function useScheduleTask(now: number) {
  const today = startOfDay(now);
  const { busy } = useDayData(today);
  const settings = useSettings().data;
  const create = useCreateBlocks();

  return (task: Pick<Task, "key" | "title" | "estimateMin">) => {
    const duration = (task.estimateMin ?? settings?.defaultEstimateMin ?? 30) * MIN;
    const dayEnd = atMinute(today, settings?.dayEndMin ?? 23 * 60);
    const slot = nextFreeSlot(busy, duration, roundUp(now), dayEnd);
    if (!slot) return toast("No free slot left today that fits it.", "error");
    create.mutate({ title: task.title, start: slot.start, end: slot.end, taskKey: task.key }, { onSuccess: () => toast(`Scheduled at ${fmtTime(slot.start)}`) });
  };
}
