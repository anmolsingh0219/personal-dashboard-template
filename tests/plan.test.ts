import { describe, expect, it } from "vitest";
import { autoPlan, freeSlots, layoutColumns, nextFreeSlot } from "../src/lib/plan";
import { parseQuickTask } from "../src/lib/quickAdd";

const MIN = 60_000;
const at = (h: number, m = 0) => new Date(2026, 8, 22, h, m).getTime();

describe("freeSlots", () => {
  it("returns the gaps between merged busy intervals", () => {
    const busy = [
      { start: at(10), end: at(11) },
      { start: at(10, 30), end: at(12) },
      { start: at(14), end: at(15) },
    ];
    expect(freeSlots(busy, at(9), at(17))).toEqual([
      { start: at(9), end: at(10) },
      { start: at(12), end: at(14) },
      { start: at(15), end: at(17) },
    ]);
  });
});

describe("nextFreeSlot", () => {
  it("snaps to the next quarter hour and skips gaps that are too short", () => {
    const busy = [{ start: at(9, 20), end: at(9, 40) }];
    expect(nextFreeSlot(busy, 30 * MIN, at(9, 7), at(12))).toEqual({ start: at(9, 45), end: at(10, 15) });
  });

  it("returns null when nothing fits", () => {
    expect(nextFreeSlot([], 90 * MIN, at(22), at(23))).toBeNull();
  });
});

describe("autoPlan", () => {
  it("places tasks in priority order around events with a buffer", () => {
    const tasks = [
      { key: "a", title: "Essay", estimateMin: 60 },
      { key: "b", title: "Too long", estimateMin: 300 },
      { key: "c", title: "Email prof", estimateMin: null },
    ];
    const busy = [{ start: at(10), end: at(11) }];
    const plan = autoPlan(tasks, busy, at(9), at(13), 30, 5);
    expect(plan).toEqual([
      { title: "Essay", start: at(11), end: at(12), taskKey: "a" },
      { title: "Email prof", start: at(9), end: at(9, 30), taskKey: "c" },
    ]);
  });
});

describe("layoutColumns", () => {
  it("splits overlapping items into columns and leaves others full width", () => {
    const items = [
      { id: 1, start: at(9), end: at(10) },
      { id: 2, start: at(9, 30), end: at(10, 30) },
      { id: 3, start: at(11), end: at(12) },
    ];
    const out = layoutColumns(items);
    expect(out.map((p) => [p.item.id, p.column, p.columns])).toEqual([
      [1, 0, 2],
      [2, 1, 2],
      [3, 0, 1],
    ]);
  });
});

describe("parseQuickTask", () => {
  const now = at(12); // Tuesday, Sept 22 2026
  it("extracts estimate and due date tokens", () => {
    expect(parseQuickTask("Finish essay ~45m @tomorrow", now)).toEqual({ title: "Finish essay", estimateMin: 45, due: "2026-09-23" });
    expect(parseQuickTask("Problem set ~1.5h @fri", now)).toEqual({ title: "Problem set", estimateMin: 90, due: "2026-09-25" });
    expect(parseQuickTask("Call mom @tue", now).due).toBe("2026-09-29");
    expect(parseQuickTask("Taxes @1/15", now).due).toBe("2027-01-15");
  });
  it("leaves unknown @words in the title", () => {
    expect(parseQuickTask("Email @alex about lab", now)).toEqual({ title: "Email @alex about lab", estimateMin: null, due: null });
  });
});
