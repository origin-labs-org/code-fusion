//
//
import assert from "node:assert/strict";
import test from "node:test";
import { SessionEventType, createSessionEvent, type SessionEvent } from "@origin-ai/cf-contracts";
import { isMainSessionEvent } from "../src/app-session-event-handler.js";

const MAIN = "session-main";
const ACTOR = "session-actor-1";

function eventFrom(sessionId: string, type: SessionEventType = SessionEventType.AssistantMessage) {
  return { ...createSessionEvent(type, sessionId as never, {}), sessionId } as SessionEvent;
}

test("every noisy actor event kind is dropped, not just some", () => {
  for (const type of [
    SessionEventType.ModelStreaming,
    SessionEventType.AssistantMessage,
    SessionEventType.ToolCallScheduled,
    SessionEventType.ToolCallResult,
    SessionEventType.ToolCallError,
    SessionEventType.TurnStarted,
    SessionEventType.TurnComplete,
  ]) {
    assert.equal(isMainSessionEvent(eventFrom(ACTOR, type), MAIN), false, `${type} leaked`);
    assert.equal(isMainSessionEvent(eventFrom(MAIN, type), MAIN), true, `${type} wrongly dropped`);
  }
});

test("dwf progress from the parent session survives the gate (the card must keep working)", () => {
  const progress = eventFrom(MAIN, SessionEventType.DynamicWorkflowRunProgress);
  assert.equal(isMainSessionEvent(progress, MAIN), true);
});

test("an unknown main session id fails open rather than blanking the transcript", () => {
  assert.equal(isMainSessionEvent(eventFrom(ACTOR), undefined), true);
  assert.equal(isMainSessionEvent(eventFrom(MAIN), ""), true);
});

test("an event with no sessionId fails open", () => {
  const anonymous = { ...eventFrom(MAIN), sessionId: undefined } as unknown as SessionEvent;
  assert.equal(isMainSessionEvent(anonymous, MAIN), true);
});

test("the gate follows the session across a swap rather than pinning the first id", () => {
  const afterSwap = "session-main-2";
  assert.equal(isMainSessionEvent(eventFrom(afterSwap), afterSwap), true);
  assert.equal(isMainSessionEvent(eventFrom(MAIN), afterSwap), false);
});
