

import { describe, expect, it } from "vitest";
import {
  AMEND_TRANSCRIPT_QUIESCE_MS,
  createActorSessionQuiescence,
} from "../src/app/workflow-driver-quiescence.js";

function manualSchedule(): {
  clock: { schedule: (callback: () => void, delayMs: number) => () => void };
  
  pending: () => number[];
  
  fire: () => void;
} {
  const alarms = new Map<number, { callback: () => void; delayMs: number }>();
  let next = 0;
  return {
    clock: {
      schedule(callback, delayMs) {
        const id = next++;
        alarms.set(id, { callback, delayMs });
        return () => alarms.delete(id);
      },
    },
    pending: () => [...alarms.values()].map((alarm) => alarm.delayMs),
    fire: () => {
      const firing = [...alarms.values()];
      alarms.clear();
      for (const alarm of firing) alarm.callback();
    },
  };
}

function deferredTurn(): { promise: Promise<void>; settle: () => void } {
  let settle!: () => void;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

describe("createActorSessionQuiescence", () => {
  it("没有在飞 turn 的会话立刻静默（一个闹钟都不排）", async () => {
    const timer = manualSchedule();
    const ledger = createActorSessionQuiescence({ clock: timer.clock });
    ledger.noteDisposed("sess-a", undefined);
    ledger.noteDisposed("sess-b", undefined);

    expect(await ledger.quietSessions()).toEqual(new Set(["sess-a", "sess-b"]));
    expect(timer.pending()).toEqual([]);
  });

  it("上界内落地的 turn 算静默，并撤掉闹钟", async () => {
    const timer = manualSchedule();
    const ledger = createActorSessionQuiescence({ clock: timer.clock });
    const turn = deferredTurn();
    ledger.noteDisposed("sess-a", turn.promise);

    const asked = ledger.quietSessions();
    expect(timer.pending()).toEqual([AMEND_TRANSCRIPT_QUIESCE_MS]);
    turn.settle();
    expect(await asked).toEqual(new Set(["sess-a"]));
    expect(timer.pending()).toEqual([]);
  });

  it("落地方式是 reject 也算静默", async () => {
    const timer = manualSchedule();
    const ledger = createActorSessionQuiescence({ clock: timer.clock });
    ledger.noteDisposed("sess-a", Promise.reject(new Error("turn blew up")));

    expect(await ledger.quietSessions()).toEqual(new Set(["sess-a"]));
  });

  it("到点仍未落地 → 不静默，其余会话照常静默", async () => {
    const timer = manualSchedule();
    const ledger = createActorSessionQuiescence({ clock: timer.clock });
    const slow = deferredTurn();
    const quick = deferredTurn();
    ledger.noteDisposed("sess-slow", slow.promise);
    ledger.noteDisposed("sess-quick", quick.promise);
    ledger.noteDisposed("sess-idle", undefined);

    const asked = ledger.quietSessions();
    quick.settle();
    timer.fire();

    expect(await asked).toEqual(new Set(["sess-quick", "sess-idle"]));
  });

  it("交出的集合不随后续落地而变大", async () => {
    const timer = manualSchedule();
    const ledger = createActorSessionQuiescence({ clock: timer.clock });
    const slow = deferredTurn();
    ledger.noteDisposed("sess-slow", slow.promise);

    const asked = ledger.quietSessions();
    timer.fire();
    const quiet = await asked;
    expect(quiet).toEqual(new Set());

    slow.settle();
    await Promise.resolve();
    expect(quiet).toEqual(new Set());
  });

  it("可重复询问（amend 之外没有别的读者，但账本不因一次询问而作废）", async () => {
    const timer = manualSchedule();
    const ledger = createActorSessionQuiescence({ clock: timer.clock });
    ledger.noteDisposed("sess-a", undefined);

    expect(await ledger.quietSessions()).toEqual(new Set(["sess-a"]));
    expect(await ledger.quietSessions()).toEqual(new Set(["sess-a"]));
  });
});
