import { describe, expect, it } from "vitest";
import {
  createSessionEvent,
  createSessionId,
  createTurnId,
  SessionEventType,
  type SessionEvent,
} from "@origin-ai/cf-contracts";
import { AgentRuntime } from "../src/runtime.js";
import { createTestSessionEventStore } from "./test-event-store.js";

describe("agent runtime external child session seams", () => {
  const parentSessionId = createSessionId("parent-session");
  const childSessionId = createSessionId("child-session");

  function childEvent(): SessionEvent {
    return createSessionEvent(
      SessionEventType.SessionTitleUpdated,
      childSessionId,
      { previousTitle: "", source: "first_input", title: "workflow actor a#1@1" },
      { sequenceNumber: 1, traceId: "trace-child", turnId: createTurnId("turn-child") },
    );
  }

  it("Hands over this runtime\'s own event store (shared with child runtimes)", () => {
    const eventStore = createTestSessionEventStore();
    const runtime = new AgentRuntime(parentSessionId, {}, { eventStore });

    expect(runtime.getSessionEventStore()).toBe(eventStore);
  });

  it("外部子会话事件扇出到外部 sinks，保留子 sessionId", async () => {
    const eventStore = createTestSessionEventStore();
    const constructorSinkEvents: SessionEvent[] = [];
    const subscribedSinkEvents: SessionEvent[] = [];
    const runtime = new AgentRuntime(
      parentSessionId,
      {},
      {
        eventStore,
        eventSink: {
          onSessionEvent: (event) => {
            constructorSinkEvents.push(event);
          },
        },
      },
    );
    runtime.subscribeEvents({
      onSessionEvent: (event) => {
        subscribedSinkEvents.push(event);
      },
    });

    const event = childEvent();
    await runtime.notifyExternalChildSessionEvent({ childSessionId, event });

    expect(constructorSinkEvents).toEqual([event]);
    expect(subscribedSinkEvents).toEqual([event]);
    expect(constructorSinkEvents[0]!.sessionId).toBe(childSessionId);
    expect(constructorSinkEvents[0]!.sequenceNumber).toBe(1);
  });

  it("只通知不 append：父会话与子会话在 store 里都没有多出事件", async () => {
    const eventStore = createTestSessionEventStore();
    const runtime = new AgentRuntime(parentSessionId, {}, { eventStore });

    await runtime.notifyExternalChildSessionEvent({ childSessionId, event: childEvent() });

    expect(await eventStore.getEvents(parentSessionId)).toHaveLength(0);
    expect(await eventStore.getEvents(childSessionId)).toHaveLength(0);
  });

  it("单个 sink 抛错不影响其余 sink（沿用 notifyEventSinks 的隔离）", async () => {
    const eventStore = createTestSessionEventStore();
    const received: SessionEvent[] = [];
    const runtime = new AgentRuntime(
      parentSessionId,
      {},
      {
        eventStore,
        eventSink: {
          onSessionEvent: () => {
            throw new Error("sink boom");
          },
        },
      },
    );
    runtime.subscribeEvents({
      onSessionEvent: (event) => {
        received.push(event);
      },
    });

    await expect(
      runtime.notifyExternalChildSessionEvent({ childSessionId, event: childEvent() }),
    ).resolves.toBeUndefined();
    expect(received).toHaveLength(1);
  });
});
