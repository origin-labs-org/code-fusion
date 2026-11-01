import { describe, expect, it } from "vitest";
import { planCalendar, planWeeks } from "../lib/board/plan-calendar";
import type { PlanView } from "../lib/board/types";

const plan = (dates: (string | undefined)[]): PlanView => ({
  id: "p",
  kind: "plan",
  checkable: false,
  steps: dates.map((date, index) => ({
    title: `Step ${index}`,
    kind: "task",
    ...(date ? { date } : {}),
  })),
});
const days = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => `2026-10-${String(from + i).padStart(2, "0")}`);

describe("plan calendar", () => {
  it("lays a month of dated steps out in whole weeks from the locale's first day", () => {
    const weeks = planWeeks(plan(days(9, 20)), { firstDay: 1, today: new Date(2026, 9, 10) })!;
    expect(weeks[0]![0]!.date).toBe("2026-10-05");
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks.at(-1)!.at(-1)!.date).toBe("2026-11-01");
    const tenth = weeks.flat().find((day) => day.date === "2026-10-10")!;
    expect(tenth.today).toBe(true);
    expect(tenth.steps).toEqual([1]);
    expect(weeks.flat().find((day) => day.date === "2026-10-05")!.outside).toBe(true);
    expect(weeks.flat().find((day) => day.date === "2026-11-01")!.opens).toBe(true);
  });

  it("keeps short, sparse or undated plans as a timeline", () => {
    expect(planWeeks(plan(days(9, 4)))).toBeNull();
    expect(planWeeks(plan(days(9, 7)))).toBeNull();
    expect(planWeeks(plan([...days(9, 12), ...Array(6).fill(undefined)]))).toBeNull();
  });

  it("shows only the weeks that hold steps, folding a run of quiet ones into one row", () => {
    const dates = [...days(5, 3), ...days(13, 2), "2026-12-02", "2026-12-03"];
    const rows = planCalendar(
      { ...plan(dates), calendar: true },
      { firstDay: 1, today: new Date(2026, 9, 10) },
    )!;
    expect(rows.map((row) => row.kind)).toEqual(["week", "week", "quiet", "week"]);
    const quiet = rows[2]!;
    expect(quiet).toMatchObject({ kind: "quiet", from: "2026-10-19", to: "2026-11-29" });
    expect(quiet.kind === "quiet" && quiet.weeks).toBe(6);
    const first = rows[0]!;
    expect(first.kind === "week" && first.month).toBe("2026-10");
    const last = rows[3]!;
    expect(last.kind === "week" && last.month).toBe("2026-12");
  });

  it("draws a step repeated on consecutive days as one bar, and counts a busy day's steps", () => {
    const stay = (date: string) => ({ title: "Hostel", kind: "stay" as const, date });
    const rows = planCalendar(
      {
        ...plan([]),
        calendar: true,
        steps: [stay("2026-10-26"), stay("2026-10-27"), stay("2026-10-28")],
      },
      { firstDay: 1 },
    )!;
    const week = rows[0]!;
    if (week.kind !== "week") throw new Error("expected a week");
    expect(week.lanes).toBe(1);
    const slots = week.days.map((day) => day.slots[0]);
    expect(slots.map((slot) => slot?.head ?? null)).toEqual([
      true,
      false,
      false,
      null,
      null,
      null,
      null,
    ]);
    expect(slots[0]).toMatchObject({ starts: true, ends: false, span: 3, steps: [0, 1, 2] });
    expect(week.days.every((day) => day.steps.length === 0)).toBe(true);
  });
});
