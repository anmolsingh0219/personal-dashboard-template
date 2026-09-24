import { describe, expect, it } from "vitest";
import { alertWindow, deadlineMessages, type Deadline } from "../shared/deadlines";

const ny = (iso: string) => Date.parse(iso); // ISO strings below carry the New York offset

describe("alertWindow", () => {
  it("fires at 8 AM for today and 7 PM for tomorrow, New York time", () => {
    expect(alertWindow(ny("2026-09-29T08:05:00-04:00"))).toEqual({ when: "today", day: "2026-09-29" });
    expect(alertWindow(ny("2026-09-28T19:05:00-04:00"))).toEqual({ when: "tomorrow", day: "2026-09-29" });
    expect(alertWindow(ny("2026-09-29T09:05:00-04:00"))).toBeNull();
    expect(alertWindow(ny("2026-09-29T00:05:00-04:00"))).toBeNull();
  });

  it("follows daylight saving and month ends", () => {
    // After the switch to EST, 8 AM is 13:05 UTC.
    expect(alertWindow(Date.parse("2026-11-02T13:05:00Z"))).toEqual({ when: "today", day: "2026-11-02" });
    expect(alertWindow(Date.parse("2026-11-02T12:05:00Z"))).toBeNull();
    expect(alertWindow(ny("2026-10-31T19:05:00-04:00"))).toEqual({ when: "tomorrow", day: "2026-11-01" });
    expect(alertWindow(ny("2026-12-31T19:05:00-05:00"))).toEqual({ when: "tomorrow", day: "2027-01-01" });
  });
});

describe("deadlineMessages", () => {
  const task: Deadline = { kind: "task", id: "t1", title: "Register for the CME challenge" };
  const job: Deadline = { kind: "job", id: "j1", title: "Jane Street: Complete HackerRank" };

  it("sends one notification per deadline, tagged so the morning alert replaces the evening one", () => {
    const tomorrow = deadlineMessages([task, job], "tomorrow", "2026-09-29");
    const today = deadlineMessages([task, job], "today", "2026-09-29");
    expect(tomorrow).toEqual([
      { title: "Due tomorrow", body: task.title, url: "/#tasks", tag: "deadline:task:t1:2026-09-29" },
      { title: "Application step due tomorrow", body: job.title, url: "/#jobs", tag: "deadline:job:j1:2026-09-29" },
    ]);
    expect(today.map((m) => m.tag)).toEqual(tomorrow.map((m) => m.tag));
    expect(today[0].title).toBe("Due today");
  });

  it("sums up a busy day in one notification", () => {
    const many = Array.from({ length: 5 }, (_, i): Deadline => ({ kind: "task", id: `t${i}`, title: `Task ${i}` }));
    expect(deadlineMessages(many, "today", "2026-09-29")).toEqual([
      { title: "5 deadlines today", body: "Task 0 · Task 1 · Task 2 · and 2 more", url: "/#tasks", tag: "deadlines:2026-09-29" },
    ]);
  });

  it("sends nothing when nothing is due", () => {
    expect(deadlineMessages([], "today", "2026-09-29")).toEqual([]);
  });
});
