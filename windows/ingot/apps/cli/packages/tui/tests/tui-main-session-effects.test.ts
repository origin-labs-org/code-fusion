//
import assert from "node:assert/strict";
import test from "node:test";
import { SessionEventType, createSessionEvent, type SessionEvent } from "@origin-ai/cf-contracts";
import { getCfCopy } from "@origin-ai/cf-i18n";
import { applyMainSessionEvent } from "../src/app-session-event-handler.js";
import type { Message } from "../src/app-model.js";
import { EMPTY_TUI_WORKFLOW_MIRROR, type TuiWorkflowMirror } from "../src/app-workflow-mirror.js";

const COPY = getCfCopy("en-US").tui;
const MAIN = "session-main";
const ACTOR = "session-actor-1";

function harness(getMainSessionId: () => string | undefined = () => MAIN) {
  const state = {
    messages: [] as Message[],
    statuses: [] as string[],
    lastEvents: [] as string[],
    mirror: EMPTY_TUI_WORKFLOW_MIRROR as TuiWorkflowMirror,
  };
  const applied = new Set<string>();
  const input = {
    copy: COPY,
    getMainSessionId,
    setActiveTurnId: () => {},
    setCacheStats: () => {},
    setContextUsage: () => {},
    setLastError: () => {},
    setLastEvent: (value: string) => state.lastEvents.push(value),
    setLiveModelText: () => {},
    setMessages: (update: unknown) => {
      state.messages =
        typeof update === "function"
          ? (update as (current: Message[]) => Message[])(state.messages)
          : (update as Message[]);
    },
    setModel: () => {},
    setNetworkRequests: () => {},
    setStatus: (value: string) => state.statuses.push(value),
    setTodos: () => {},
    setUsage: () => {},
    setWorkflowMirror: (update: unknown) => {
      state.mirror =
        typeof update === "function"
          ? (update as (current: TuiWorkflowMirror) => TuiWorkflowMirror)(state.mirror)
          : (update as TuiWorkflowMirror);
    },
    assistantMessageIdsByToolCallId: new Map<string, string>(),
    toolNamesById: new Map<string, string>(),
  } as unknown as Parameters<typeof applyMainSessionEvent>[2];

  return {
    state,
    apply: (event: SessionEvent) => applyMainSessionEvent(event, applied, input),
  };
}

function event(sessionId: string, type: SessionEventType, payload: unknown = {}): SessionEvent {
  return { ...createSessionEvent(type, sessionId as never, payload), sessionId } as SessionEvent;
}

test("an actor turn_complete never appends its answer through the fallback", () => {
  const h = harness();
  const applied = h.apply(
    event(ACTOR, SessionEventType.TurnComplete, { response: "actor internal answer" }),
  );
  assert.equal(applied, false);
  assert.deepEqual(h.state.messages, []);
  assert.deepEqual(h.state.statuses, []);
});

test("a main-session turn_complete still appends through the fallback", () => {
  const h = harness();
  assert.equal(
    h.apply(event(MAIN, SessionEventType.TurnComplete, { response: "the real answer" })),
    true,
  );
  assert.equal(h.state.messages.length, 1);
  assert.equal(h.state.messages[0]?.content, "the real answer");
});

test("actor submit_result / tool_call_* create no transcript parts and no status changes", () => {
  const h = harness();
  const toolEvents: readonly [SessionEventType, unknown][] = [
    [
      SessionEventType.ToolCallScheduled,
      { toolCallId: "tc-a", toolName: "submit_result", input: {} },
    ],
    [SessionEventType.ToolCallStarted, { toolCallId: "tc-a", toolName: "submit_result" }],
    [
      SessionEventType.ToolCallResult,
      { toolCallId: "tc-a", toolName: "submit_result", result: { content: "ok" } },
    ],
    [SessionEventType.ToolCallError, { toolCallId: "tc-a", toolName: "submit_result" }],
  ];
  for (const [type, payload] of toolEvents) {
    assert.equal(h.apply(event(ACTOR, type, payload)), false, `${type} passed the gate`);
  }
  assert.deepEqual(h.state.messages, []);
  assert.deepEqual(h.state.statuses, []);
  assert.deepEqual(h.state.lastEvents, []);
});

test("actor turn lifecycle events do not touch the main status line", () => {
  const h = harness();
  h.apply(event(ACTOR, SessionEventType.TurnStarted, {}));
  h.apply(event(ACTOR, SessionEventType.ModelRequest, {}));
  assert.deepEqual(h.state.statuses, []);
});

test("dwf progress on the parent session still reduces into the mirror", () => {
  const h = harness();
  const applied = h.apply(
    event(MAIN, SessionEventType.DynamicWorkflowRunProgress, {
      runId: "dwfrun-1",
      toolCallId: "tc-1",
      sequence: 0,
      eventType: "run-started",
      payload: { caps: { maxConcurrency: 4 } },
    }),
  );
  assert.equal(applied, true);
  assert.equal(h.state.mirror.state.runs[0]?.runId, "dwfrun-1");
  assert.equal(h.state.mirror.state.runs[0]?.status, "running");
});

test("a mirrored subagent tool event still renders (it carries the parent sessionId)", () => {
  const h = harness();
  const applied = h.apply(
    event(MAIN, SessionEventType.ToolCallScheduled, {
      toolCallId: "tc-agent",
      toolName: "Agent",
      input: { description: "explore" },
    }),
  );
  assert.equal(applied, true);
  assert.equal(h.state.messages.length, 1);
});

test("the actor gate does not depend on event kind — only on session", () => {
  const h = harness();
  assert.equal(h.apply(event(MAIN, SessionEventType.AssistantMessage, { content: "main" })), true);
  assert.equal(
    h.apply(event(ACTOR, SessionEventType.AssistantMessage, { content: "actor" })),
    false,
  );
  assert.deepEqual(
    h.state.messages.map((message) => message.content),
    ["main"],
  );
});

test("drops actor events and deduplicates repeated main events", () => {
  const h = harness();
  const actorEvent = event(ACTOR, SessionEventType.AssistantMessage, { content: "noise" });
  h.apply(actorEvent);
  h.apply(actorEvent);
  const mainEvent = event(MAIN, SessionEventType.AssistantMessage, { content: "signal" });
  assert.equal(h.apply(mainEvent), true);
  assert.equal(h.apply(mainEvent), false);
  assert.deepEqual(
    h.state.messages.map((message) => message.content),
    ["signal"],
  );
});

test("an unknown main session id fails open so the transcript is never blank", () => {
  const h = harness(() => undefined);
  assert.equal(h.apply(event(ACTOR, SessionEventType.AssistantMessage, { content: "x" })), true);
});
