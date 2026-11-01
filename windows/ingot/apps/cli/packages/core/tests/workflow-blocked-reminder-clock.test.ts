// ============================================================
// 「Reminding an idle main agent」）
// ============================================================

import { describe, expect, it } from "vitest";
import {
  WorkflowBlockedReminderClock,
  type WorkflowBlockedReminder,
  type WorkflowOpenDecisions,
} from "../src/runtime-task/workflow-blocked-reminder.js";

const MIN = 60_000;
const FIRST = 15 * MIN;
const SECOND = 30 * MIN;

function question(qid: string, askedAt = 0): WorkflowOpenDecisions["questions"][number] {
  return { qid, actor: "actor#1@1", question: `q ${qid}`, askedAt };
}

function hole(siteId: string, since = 0): WorkflowOpenDecisions["holes"][number] {
  return { siteId, ordinal: 1, name: siteId, type: "Plan", state: "waiting", since };
}

interface Harness {
  clock: WorkflowBlockedReminderClock;
  
  open: Map<string, WorkflowOpenDecisions>;
  live: Set<string>;
  sent: WorkflowBlockedReminder[];
  reads: string[];
  idle: { value: boolean };
  
  advance(ms: number): Promise<void>;
  
  turn(durationMs?: number): Promise<void>;
  pendingTimers(): number;
}

function harness(): Harness {
  let now = 0;
  let nextTimerId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const open = new Map<string, WorkflowOpenDecisions>();
  const live = new Set<string>();
  const sent: WorkflowBlockedReminder[] = [];
  const reads: string[] = [];
  const idle = { value: true };
  const clock = new WorkflowBlockedReminderClock({
    isIdle: () => idle.value,
    liveRunIds: () => [...live],
    now: () => now,
    readOpen: async (runId) => {
      reads.push(runId);
      return open.get(runId);
    },
    remind: (reminder) => {
      sent.push(reminder);
    },
    setTimer: (callback, delayMs) => {
      const id = nextTimerId++;
      timers.set(id, { at: now + delayMs, callback });
      return () => timers.delete(id);
    },
  });
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  const advance = async (ms: number): Promise<void> => {
    const target = now + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (due === undefined) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].callback();
      await settle();
    }
    now = target;
    await settle();
  };
  return {
    advance,
    clock,
    idle,
    live,
    open,
    pendingTimers: () => timers.size,
    reads,
    sent,
    turn: async (durationMs = 0) => {
      idle.value = false;
      clock.sessionBusy();
      await advance(durationMs);
      idle.value = true;
      clock.sessionIdle();
    },
  };
}

describe("WorkflowBlockedReminderClock", () => {
  it("没有在飞的 run：空闲沿什么也不排", async () => {
    const h = harness();
    h.clock.sessionIdle();
    expect(h.pendingTimers()).toBe(0);
    await h.advance(2 * 60 * MIN);
    expect(h.sent).toEqual([]);
    expect(h.reads).toEqual([]);
  });

  it("空闲满 15 分钟且 run 还欠着决定：恰好一条提醒，载着到点那一刻读到的开集", async () => {
    const h = harness();
    h.live.add("run-a");
    h.open.set("run-a", { questions: [question("q1")], holes: [hole("hole#1")] });
    h.clock.sessionIdle();

    await h.advance(FIRST - 1);
    expect(h.sent).toEqual([]);
    expect(h.reads).toEqual([]);

    await h.advance(1);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({ runId: "run-a", ordinal: 1, total: 2, now: FIRST });
    expect(h.sent[0]?.open.questions.map((q) => q.qid)).toEqual(["q1"]);
    expect(h.sent[0]?.open.holes.map((entry) => entry.siteId)).toEqual(["hole#1"]);
  });

  it("No open decisions left at expiration time: do not remind, and do not consume this run\'s count", async () => {
    const h = harness();
    h.live.add("run-a");
    h.clock.sessionIdle();
    await h.advance(FIRST);
    expect(h.reads).toEqual(["run-a"]);
    expect(h.sent).toEqual([]);

    h.open.set("run-a", { questions: [question("q1")], holes: [] });
    await h.turn();
    await h.advance(FIRST);
    expect(h.sent.map((r) => r.ordinal)).toEqual([1]);
  });

  it("量的是空闲时长：任何一轮开始都让钟归零，决定开了多久不算数", async () => {
    const h = harness();
    h.live.add("run-a");
    h.open.set("run-a", { questions: [question("q1")], holes: [] });
    h.clock.sessionIdle();

    await h.advance(FIRST - MIN);
    await h.turn(40 * MIN);
    expect(h.sent).toEqual([]);

    await h.advance(FIRST - 1);
    expect(h.sent).toEqual([]);
    await h.advance(1);
    expect(h.sent).toHaveLength(1);
  });

  it("Second reminder occurs after another 30 minutes of idle time following the first reminder\'s turn; none thereafter", async () => {
    const h = harness();
    h.live.add("run-a");
    h.open.set("run-a", { questions: [question("q1")], holes: [] });
    h.clock.sessionIdle();
    await h.advance(FIRST);
    expect(h.sent.map((r) => r.ordinal)).toEqual([1]);

    await h.turn(MIN);
    await h.advance(SECOND - 1);
    expect(h.sent).toHaveLength(1);
    await h.advance(1);
    expect(h.sent.map((r) => r.ordinal)).toEqual([1, 2]);

    await h.turn(MIN);
    await h.advance(24 * 60 * MIN);
    expect(h.sent).toHaveLength(2);
    expect(h.pendingTimers()).toBe(0);
  });

  it("别的后台通知唤起的一轮不是新的开始：次数不清零", async () => {
    const h = harness();
    h.live.add("run-a");
    h.open.set("run-a", { questions: [question("q1")], holes: [] });
    h.clock.sessionIdle();
    await h.advance(FIRST);
    await h.turn();
    await h.advance(SECOND);
    expect(h.sent).toHaveLength(2);

    for (let i = 0; i < 5; i++) {
      await h.turn(MIN);
      await h.advance(SECOND);
    }
    expect(h.sent).toHaveLength(2);
  });

  it("用户发话给每个 run 一对新的提醒", async () => {
    const h = harness();
    h.live.add("run-a");
    h.open.set("run-a", { questions: [question("q1")], holes: [] });
    h.clock.sessionIdle();
    await h.advance(FIRST);
    await h.turn();
    await h.advance(SECOND);
    expect(h.sent).toHaveLength(2);

    h.clock.userSpoke();
    await h.turn(MIN);
    await h.advance(FIRST);
    expect(h.sent.map((r) => r.ordinal)).toEqual([1, 2, 1]);
  });

  it("Changes to this run\'s open set give it a fresh pair of reminders; other runs are unaffected", async () => {
    const h = harness();
    h.live.add("run-a");
    h.live.add("run-b");
    h.open.set("run-a", { questions: [question("a1"), question("a2")], holes: [] });
    h.open.set("run-b", { questions: [], holes: [hole("hole#b")] });
    h.clock.sessionIdle();
    await h.advance(FIRST);
    await h.turn();
    await h.advance(SECOND);
    expect(h.sent.map((r) => `${r.runId}:${r.ordinal}`)).toEqual([
      "run-a:1",
      "run-b:1",
      "run-a:2",
      "run-b:2",
    ]);

    h.idle.value = false;
    h.clock.sessionBusy();
    h.open.set("run-a", { questions: [question("a2")], holes: [] });
    h.clock.openSetChanged("run-a");
    h.idle.value = true;
    h.clock.sessionIdle();

    await h.advance(FIRST);
    expect(h.sent.slice(4).map((r) => `${r.runId}:${r.ordinal}`)).toEqual(["run-a:1"]);
  });

  it("空闲期间开集变化：空闲钟从那一刻重新起算", async () => {
    const h = harness();
    h.live.add("run-a");
    h.open.set("run-a", { questions: [question("q1")], holes: [] });
    h.clock.sessionIdle();
    await h.advance(FIRST);
    await h.turn();
    await h.advance(SECOND);
    expect(h.sent).toHaveLength(2);
    await h.turn();

    await h.advance(180 * MIN);
    h.clock.openSetChanged("run-a");
    await h.advance(FIRST - 1);
    expect(h.sent).toHaveLength(2);
    await h.advance(1);
    expect(h.sent.map((r) => r.ordinal)).toEqual([1, 2, 1]);
  });

  it("Counts are tracked independently: if one run used one and another hasn\'t, each fires on its own delay", async () => {
    const h = harness();
    h.live.add("run-a");
    h.open.set("run-a", { questions: [question("a1")], holes: [] });
    h.clock.sessionIdle();
    await h.advance(FIRST);
    expect(h.sent.map((r) => `${r.runId}:${r.ordinal}`)).toEqual(["run-a:1"]);

    h.idle.value = false;
    h.clock.sessionBusy();
    h.live.add("run-b");
    h.open.set("run-b", { questions: [], holes: [hole("hole#b")] });
    h.clock.openSetChanged("run-b");
    h.idle.value = true;
    h.clock.sessionIdle();

    await h.advance(FIRST);
    expect(h.sent.slice(1).map((r) => `${r.runId}:${r.ordinal}`)).toEqual(["run-b:1"]);
  });

  it("到点那一刻会话其实不闲（钟没来得及被停）：不读、不发", async () => {
    const h = harness();
    h.live.add("run-a");
    h.open.set("run-a", { questions: [question("q1")], holes: [] });
    h.clock.sessionIdle();
    h.idle.value = false;
    await h.advance(FIRST);
    expect(h.reads).toEqual([]);
    expect(h.sent).toEqual([]);
  });

  it("读快照期间来了一轮：作废这次到点，不在那一轮旁边再塞一条", async () => {
    let now = 0;
    const timers: { at: number; callback: () => void }[] = [];
    let release: (() => void) | undefined;
    const sent: WorkflowBlockedReminder[] = [];
    const clock = new WorkflowBlockedReminderClock({
      isIdle: () => true,
      liveRunIds: () => ["run-a"],
      now: () => now,
      readOpen: () =>
        new Promise((resolve) => {
          release = () => resolve({ questions: [question("q1")], holes: [] });
        }),
      remind: (reminder) => {
        sent.push(reminder);
      },
      setTimer: (callback, delayMs) => {
        const timer = { at: now + delayMs, callback };
        timers.push(timer);
        return () => {
          const index = timers.indexOf(timer);
          if (index >= 0) timers.splice(index, 1);
        };
      },
    });
    clock.sessionIdle();
    now = FIRST;
    timers.shift()?.callback();
    await Promise.resolve();
    clock.sessionBusy();
    release?.();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(sent).toEqual([]);
  });

  it("读快照抛错：这个 run 跳过，别的 run 照常提醒", async () => {
    const sent: WorkflowBlockedReminder[] = [];
    let fire: (() => void) | undefined;
    const clock = new WorkflowBlockedReminderClock({
      isIdle: () => true,
      liveRunIds: () => ["run-bad", "run-ok"],
      now: () => FIRST,
      readOpen: async (runId) => {
        if (runId === "run-bad") throw new Error("journal closed");
        return { questions: [question("q1")], holes: [] };
      },
      remind: (reminder) => {
        sent.push(reminder);
      },
      setTimer: (callback) => {
        fire = callback;
        return () => {};
      },
    });
    clock.sessionIdle();
    fire?.();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(sent.map((r) => r.runId)).toEqual(["run-ok"]);
  });

  it("不再在飞的 run：跳过，并忘掉它的次数", async () => {
    const h = harness();
    h.live.add("run-a");
    h.open.set("run-a", { questions: [question("q1")], holes: [] });
    h.clock.sessionIdle();
    await h.advance(FIRST);
    expect(h.sent).toHaveLength(1);

    h.live.delete("run-a");
    await h.turn();
    await h.advance(SECOND);
    expect(h.sent).toHaveLength(1);

    h.live.add("run-a");
    await h.turn();
    await h.advance(FIRST);
    expect(h.sent.map((r) => r.ordinal)).toEqual([1, 1]);
  });

  it("stop 之后一切静默：到点不发，空闲沿不再排", async () => {
    const h = harness();
    h.live.add("run-a");
    h.open.set("run-a", { questions: [question("q1")], holes: [] });
    h.clock.sessionIdle();
    h.clock.stop();
    expect(h.pendingTimers()).toBe(0);
    await h.advance(FIRST);
    h.clock.sessionBusy();
    h.clock.sessionIdle();
    await h.advance(FIRST);
    expect(h.sent).toEqual([]);
  });

  it("重复的空闲沿不重置空闲时长（空排一次队列不是一轮）", async () => {
    const h = harness();
    h.live.add("run-a");
    h.open.set("run-a", { questions: [question("q1")], holes: [] });
    h.clock.sessionIdle();
    await h.advance(FIRST - MIN);
    h.clock.sessionIdle();
    await h.advance(MIN);
    expect(h.sent).toHaveLength(1);
  });
});
