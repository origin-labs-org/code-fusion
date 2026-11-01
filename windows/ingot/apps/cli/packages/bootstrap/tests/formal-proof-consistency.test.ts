//
//   sendText / setGoal     → inputRouting.mode（allow→startNow / enqueue→enqueue / reject→reject）
import { describe, expect, it } from "vitest";
import {
  evaluate,
  userCandidates,
  type Candidate,
  type ProductContext,
} from "@origin-ai/cf-formal-proof/model";
import type { SessionEvent } from "@origin-ai/cf-contracts";
import { SessionEventType } from "@origin-ai/cf-contracts";
import {
  ProductProjection,
  computeAvailability,
  computeInputRouting,
  type AvailabilityContext,
} from "../src/cf-protocol-v4/index.js";

const RUN_PHASES = ["idle", "running", "completed", "compacting", "goalVerifying"] as const;
const QUEUES = ["empty", "text", "goal", "compact", "mixed"] as const;
const COMPACT_MEMORIES = ["never", "compactable", "justCompacted", "notNeeded"] as const;
const GOALS = ["none", "active", "verifying", "verified", "failed"] as const;
const TURNS = ["latest", "old", "none"] as const;

function toAvailabilityContext(context: ProductContext): AvailabilityContext {
  return {
    phase:
      context.runPhase === "running" || context.runPhase === "goalVerifying"
        ? "running"
        : context.runPhase === "idle"
          ? "draft"
          : "completedSuccess",
    goalStatus:
      context.goal === "none"
        ? null
        : context.goal === "verifying"
          ? "verifying"
          : context.goal === "verified"
            ? "verified"
            : context.goal === "failed"
              ? "failed"
              : "active",
    compacting: context.runPhase === "compacting",
    goalVerifying: context.runPhase === "goalVerifying",
    queueLength: context.queue === "empty" ? 0 : 1,
    autoDrain: context.queue === "empty",
  };
}

function isCoherent(context: ProductContext): boolean {
  return (context.runPhase === "goalVerifying") === (context.goal === "verifying");
}

const DECISION_OVERRIDES = new Set(["justCompactedNoNeed"]);

const REASON_CODE_BY_RULE_ID: Record<string, string> = {
  compactingCannotCompact: "compactOperationLock",
  idleCannotCompact: "idleCannotCompact",
  compactingAcceptsFutureInput: "compactingAcceptsFutureInput",
  goalVerifierAcceptsFutureInput: "goalVerifierAcceptsFutureInput",
  heldQueueInputRequiresChoice: "heldQueueInputRequiresChoice",
};

function* coherentContexts(): Generator<ProductContext> {
  for (const runPhase of RUN_PHASES) {
    for (const queue of QUEUES) {
      for (const compactMemory of COMPACT_MEMORIES) {
        for (const canCompactAgain of [true, false]) {
          for (const goal of GOALS) {
            for (const selectedTurn of TURNS) {
              for (const forked of [true, false]) {
                const context: ProductContext = {
                  runPhase,
                  queue,
                  compactMemory,
                  canCompactAgain,
                  goal,
                  selectedTurn,
                  forked,
                };
                if (isCoherent(context)) yield context;
              }
            }
          }
        }
      }
    }
  }
}

function candidateById(id: string): Candidate {
  const candidate = userCandidates.find((item) => item.id === id);
  if (!candidate) throw new Error(`unknown candidate: ${id}`);
  return candidate;
}

describe("formal-proof 全枚举 ↔ guard 同源派生一致", () => {
  it("compact/slashCompact：Decision ↔ availability.compact 全枚举一致", () => {
    let checked = 0;
    for (const context of coherentContexts()) {
      const availability = computeAvailability(toAvailabilityContext(context));
      for (const candidateId of ["compact", "slashCompact"]) {
        const decision = evaluate(context, candidateById(candidateId));
        if (DECISION_OVERRIDES.has(decision.ruleId)) {
          expect(availability.compact.allowed).toBe(true);
          checked += 1;
          continue;
        }
        const label = `${JSON.stringify(context)} × ${candidateId} → ${decision.ruleId}`;
        if (decision.kind === "allow" || decision.kind === "enqueue") {
          expect(availability.compact, label).toEqual({ allowed: true });
        } else if (decision.kind === "reject") {
          const reasonCode = REASON_CODE_BY_RULE_ID[decision.ruleId];
          expect(reasonCode, `未登记的 reject ruleId：${label}`).toBeDefined();
          expect(availability.compact, label).toEqual({
            allowed: false,
            reasonCode,
          });
        } else {
          throw new Error(`compact 候选出现未预期Adjudication种类：${label}`);
        }
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(3000);
  });

  it("sendText/setGoal：Decision ↔ inputRouting.mode 全枚举一致", () => {
    let checked = 0;
    for (const context of coherentContexts()) {
      const routing = computeInputRouting(toAvailabilityContext(context), "queue");
      for (const candidateId of ["sendText", "setGoal"]) {
        const decision = evaluate(context, candidateById(candidateId));
        const label = `${JSON.stringify(context)} × ${candidateId} → ${decision.ruleId}`;
        if (decision.kind === "allow") {
          expect(routing.mode, label).toBe("startNow");
        } else if (decision.kind === "enqueue") {
          expect(routing.mode, label).toBe("enqueue");
          if (
            decision.ruleId === "compactingAcceptsFutureInput" ||
            decision.ruleId === "goalVerifierAcceptsFutureInput"
          ) {
            expect(routing.reasonCode, label).toBe(REASON_CODE_BY_RULE_ID[decision.ruleId]);
          }
        } else if (decision.kind === "choice") {
          expect(routing.mode, label).toBe("choice");
          expect(routing.reasonCode, label).toBe(REASON_CODE_BY_RULE_ID[decision.ruleId]);
        } else if (decision.kind === "reject") {
          expect(routing.mode, label).toBe("reject");
          expect(routing.reasonCode, label).toBe(REASON_CODE_BY_RULE_ID[decision.ruleId]);
        } else if (decision.kind === "undefined") {
          checked -= 1;
        } else {
          throw new Error(`send 候选出现未预期Adjudication种类：${label}`);
        }
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(2000);
  });
});

describe("formal-proof 原型 ↔ reducer 事件流投影一致", () => {
  let eventSeq = 0;
  function makeEvent(type: SessionEvent["type"], payload: unknown, turnId?: string): SessionEvent {
    eventSeq += 1;
    return {
      id: `event-${eventSeq}`,
      sessionId: "session-1",
      turnId,
      type,
      timestamp: new Date(1_700_000_000_000 + eventSeq * 1000),
      traceId: "trace-1",
      sequenceNumber: eventSeq,
      payload,
    } as SessionEvent;
  }

  function project(events: SessionEvent[]): ProductProjection {
    const projection = new ProductProjection("session-1", "epoch-1");
    for (const event of events) projection.applyEvent(event);
    return projection;
  }

  const created = () =>
    makeEvent(SessionEventType.SessionCreated, {
      mode: "default",
      contextWindow: 1000,
    });
  const turnStarted = () =>
    makeEvent(SessionEventType.TurnStarted, { turnNumber: 1, input: "hi" }, "turn-1");
  const turnDone = () =>
    makeEvent(
      SessionEventType.TurnComplete,
      {
        response: "ok",
        tokenCount: 1,
        toolCallCount: 0,
        duration: 10,
        resultType: "success",
      },
      "turn-1",
    );

  it("idle（draft）：compact 拒绝 idleCannotCompact，输入 startNow", () => {
    const snapshot = project([created()]).getSnapshot();
    expect(snapshot.availability.compact).toEqual({
      allowed: false,
      reasonCode: "idleCannotCompact",
    });
    expect(snapshot.inputRouting.mode).toBe("startNow");
  });

  it("running：compact 可提交并进入 typed queue，输入 enqueue", () => {
    const snapshot = project([created(), turnStarted()]).getSnapshot();
    expect(snapshot.availability.compact).toEqual({ allowed: true });
    expect(snapshot.inputRouting.mode).toBe("enqueue");
  });

  it("completed：compact 放行，输入 startNow", () => {
    const snapshot = project([created(), turnStarted(), turnDone()]).getSnapshot();
    expect(snapshot.availability.compact).toEqual({ allowed: true });
    expect(snapshot.inputRouting.mode).toBe("startNow");
  });

  it("compacting：compact 拒绝 compactOperationLock，输入 enqueue（compactingAcceptsFutureInput）；终态解锁", () => {
    const projection = project([
      created(),
      turnStarted(),
      turnDone(),
      makeEvent(SessionEventType.CompactStarted, {
        operationId: "op-1",
        messageId: "msg-1",
        status: "started",
        trigger: "manual",
        display: "separator",
      }),
    ]);
    const during = projection.getSnapshot();
    expect(during.control.activeWorks).toEqual([expect.objectContaining({ kind: "compact" })]);
    expect(during.availability.compact).toEqual({
      allowed: false,
      reasonCode: "compactOperationLock",
    });
    expect(during.inputRouting).toEqual({
      mode: "enqueue",
      reasonCode: "compactingAcceptsFutureInput",
    });

    projection.applyEvent(
      makeEvent(SessionEventType.CompactCompleted, {
        operationId: "op-1",
        messageId: "msg-1",
        status: "completed",
        trigger: "manual",
        display: "separator",
        preCompactTokenCount: 800,
        postCompactTokenCount: 300,
      }),
    );
    const after = projection.getSnapshot();
    expect(after.control.activeWorks).toEqual([]);
    expect(after.availability.compact).toEqual({ allowed: true });
    expect(after.inputRouting.mode).toBe("startNow");
  });

  it("goalVerifying：消息与 compact 都可入队；验证通过后恢复立即执行", () => {
    const projection = project([
      created(),
      turnStarted(),
      turnDone(),
      makeEvent(SessionEventType.TargetChanged, {
        action: "set",
        source: "command",
        target: {
          sessionID: "session-1",
          targetID: "target-1",
          objective: "修绿测试",
          summaryTitle: null,
          status: "active",
          tokenBudget: null,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          time: { created: 0, updated: 0 },
        },
        previousTarget: null,
      }),
      makeEvent(SessionEventType.TargetCompletionVerification, {
        targetId: "target-1",
        status: "started",
        verificationId: "verify-1",
        goalIteration: 1,
      }),
    ]);
    expect(projection.getSnapshot().availability.compact).toEqual({ allowed: true });
    expect(projection.getSnapshot().inputRouting).toEqual({
      mode: "enqueue",
      reasonCode: "goalVerifierAcceptsFutureInput",
    });

    projection.applyEvent(
      makeEvent(SessionEventType.TargetCompletionVerification, {
        targetId: "target-1",
        status: "completed",
        verificationId: "verify-1",
        goalIteration: 1,
        verification: { passed: true, reason: "ok" },
      }),
    );
    expect(projection.getSnapshot().availability.compact).toEqual({
      allowed: true,
    });
  });

  it("held（stop + 残留 queue）：autoDrain=false，输入 choice（heldQueueInputRequiresChoice）", () => {
    const projection = project([
      created(),
      turnStarted(),
      makeEvent(
        SessionEventType.TurnSteerQueued,
        {
          pendingInputId: "pi-1",
          input: "Add a test while we\'re at it",
          inputPreview: "Add a test while we\'re at it",
          inputSize: 6,
          targetTurnId: "turn-1",
          queueLength: 1,
        },
        "turn-1",
      ),
      makeEvent(
        SessionEventType.TurnComplete,
        {
          response: "",
          tokenCount: 0,
          toolCallCount: 0,
          duration: 100,
          resultType: "cancelled",
        },
        "turn-1",
      ),
    ]);
    const snapshot = projection.getSnapshot();
    expect(snapshot.queue.items).toHaveLength(1);
    expect(snapshot.queue.autoDrain).toBe(false);
    expect(snapshot.inputRouting).toEqual({
      mode: "choice",
      reasonCode: "heldQueueInputRequiresChoice",
    });

    projection.applyEvent(
      makeEvent(
        SessionEventType.TurnSteerDiscarded,
        { pendingInputIds: ["pi-1"], reason: "user_cleared" },
        "turn-1",
      ),
    );
    expect(projection.getSnapshot().inputRouting.mode).toBe("startNow");
  });
});
