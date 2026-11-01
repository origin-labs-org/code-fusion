import { describe, expect, it } from "vitest";
import type { AccountRequestV1 } from "$shared/ipc/bindings";
import { addDays, callsByDay, groupCalls, startOfDay } from "../lib/call-groups";

function call(
  id: string,
  state: string,
  charged: string,
  source: AccountRequestV1["source"],
  at = "2026-10-19T10:00:00Z",
): AccountRequestV1 {
  return {
    id,
    model_id: "gpt-6-luna",
    state,
    charged,
    reserved: "1200000",
    started_at: at,
    finished_at: null,
    error_class: null,
    funding: null,
    source,
  };
}

const task = (work: string, profile = "p1") => ({ kind: "task" as const, profile, work });

describe("usage history grouped by what made each call", () => {
  it("makes one group per task, with voice and the unknown in their own", () => {
    const groups = groupCalls([
      call("1", "settled", "300000", task("w1")),
      call("2", "settled", "30000", { kind: "voice" }),
      call("3", "settled", "500000", task("w2")),
      call("4", "settled", "100000", task("w1")),
      call("5", "settled", "7", null),
    ]);
    expect(groups.map((group) => [group.key, group.kind, group.calls.length])).toEqual([
      ["task:p1:w1", "task", 2],
      ["voice", "voice", 1],
      ["task:p1:w2", "task", 1],
      ["other", "other", 1],
    ]);
    expect(groups[0]!.total).toBe("400000");
    expect(groups[0]!.task).toEqual({ profile: "p1", work: "w1" });
    expect(groups[1]!.task).toBeNull();
  });

  it("keeps the order the newest call of each group gives, and its time", () => {
    const groups = groupCalls([
      call("1", "settled", "1", task("late"), "2026-10-19T12:00:00Z"),
      call("2", "settled", "1", task("early"), "2026-10-19T09:00:00Z"),
      call("3", "settled", "1", task("late"), "2026-10-19T08:00:00Z"),
    ]);
    expect(groups.map((group) => group.task?.work)).toEqual(["late", "early"]);
    expect(groups[0]!.latest).toBe("2026-10-19T12:00:00Z");
  });

  it("keeps the same task in two profiles apart", () => {
    const groups = groupCalls([
      call("1", "settled", "1", task("w", "p1")),
      call("2", "settled", "1", task("w", "p2")),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("totals only what settled and counts what is still open", () => {
    const [group] = groupCalls([
      call("1", "settled", "300000", task("w")),
      call("2", "running", "0", task("w")),
      call("3", "usage_unknown", "0", task("w")),
      call("4", "released", "0", task("w")),
    ]);
    expect(group!.total).toBe("300000");
    expect(group!.unsettled).toBe(2);
  });

  it("is empty for no calls", () => {
    expect(groupCalls([])).toEqual([]);
  });
});

describe("usage history by day", () => {
  const local = (day: number, hour: number) => new Date(2026, 9, day, hour).toISOString();
  const today = startOfDay(new Date(2026, 9, 21, 12).getTime());

  it("puts each call on the local day it began, a day once however its calls are listed", () => {
    const days = callsByDay(
      [
        call("a", "settled", "1", null, local(21, 9)),
        call("b", "settled", "1", null, local(20, 23)),
        call("c", "settled", "1", null, local(21, 1)),
        { ...call("d", "settled", "1", null), started_at: null },
        call("e", "settled", "1", null, local(18, 0)),
      ],
      today,
    );
    expect(days.map(({ day, calls }) => [day, calls.map((one) => one.id)])).toEqual([
      [today, ["a", "c", "d"]],
      [addDays(today, -1), ["b"]],
      [addDays(today, -3), ["e"]],
    ]);
  });

  it("counts calendar days across a clock change", () => {
    const march = startOfDay(new Date(2026, 2, 30, 12).getTime());
    expect(new Date(addDays(march, -1)).getDate()).toBe(29);
    expect(new Date(addDays(march, -29)).getDate()).toBe(1);
  });
});
