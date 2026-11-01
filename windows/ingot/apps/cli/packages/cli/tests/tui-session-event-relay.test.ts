//
import assert from "node:assert/strict";
import test from "node:test";
import type { SessionEvent } from "@origin-ai/cf-contracts";
import { createTuiSessionEventRelay } from "../src/tui-session-event-relay.js";

function fakeRuntime(name: string) {
  const state = {
    name,
    attachCount: 0,
    detachCount: 0,
    emit: (_event: SessionEvent) => {},
    attached: false,
  };
  const subscribe = (sink: { onSessionEvent: (event: SessionEvent) => void }) => {
    state.attachCount += 1;
    state.attached = true;
    state.emit = (event) => sink.onSessionEvent(event);
    return () => {
      state.detachCount += 1;
      state.attached = false;
      state.emit = () => {};
    };
  };
  return { state, runtime: { subscribeEvents: subscribe } };
}

const readSubscriber = (runtime: unknown) => {
  const candidate = (runtime as { subscribeEvents?: unknown } | undefined)?.subscribeEvents;
  return typeof candidate === "function"
    ? (candidate as (sink: { onSessionEvent: (event: SessionEvent) => void }) => () => void)
    : undefined;
};

const event = (id: string) =>
  ({ id, type: "dynamic_workflow_run_progress" }) as unknown as SessionEvent;

test("the first sink attaches to the current runtime", () => {
  const first = fakeRuntime("first");
  const relay = createTuiSessionEventRelay({
    currentRuntime: () => first.runtime,
    readSubscriber,
  });

  assert.equal(relay.isAttached(), false);
  const received: string[] = [];
  relay.addSink((e) => received.push(e.id));

  assert.equal(relay.isAttached(), true);
  assert.equal(first.state.attachCount, 1);
  first.state.emit(event("e1"));
  assert.deepEqual(received, ["e1"]);
});

test("reattach after an app swap detaches the old runtime and follows the new one", () => {
  const first = fakeRuntime("first");
  const second = fakeRuntime("second");
  let current: unknown = first.runtime;
  const relay = createTuiSessionEventRelay({
    currentRuntime: () => current,
    readSubscriber,
  });

  const received: string[] = [];
  relay.addSink((e) => received.push(e.id));
  first.state.emit(event("before-swap"));

  current = second.runtime;
  relay.reattach();

  assert.equal(first.state.detachCount, 1, "old runtime must be detached");
  assert.equal(second.state.attachCount, 1, "new runtime must be attached");
  assert.equal(first.state.attached, false);

  second.state.emit(event("after-swap"));
  first.state.emit(event("orphan"));
  assert.deepEqual(received, ["before-swap", "after-swap"]);
});

test("remains attached across two app swaps", () => {
  const first = fakeRuntime("first");
  const second = fakeRuntime("second");
  let current: unknown = first.runtime;
  const relay = createTuiSessionEventRelay({ currentRuntime: () => current, readSubscriber });

  const received: string[] = [];
  relay.addSink((e) => received.push(e.id));
  current = second.runtime;
  relay.reattach();
  current = fakeRuntime("third").runtime;
  relay.reattach();

  assert.equal(relay.isAttached(), true);
  assert.equal(received.length, 0);
});

test("reattach with no sinks stays detached (no subscription leak)", () => {
  const only = fakeRuntime("only");
  const relay = createTuiSessionEventRelay({ currentRuntime: () => only.runtime, readSubscriber });

  relay.reattach();
  assert.equal(relay.isAttached(), false);
  assert.equal(only.state.attachCount, 0);
});

test("the last sink unsubscribing detaches the runtime", () => {
  const only = fakeRuntime("only");
  const relay = createTuiSessionEventRelay({ currentRuntime: () => only.runtime, readSubscriber });

  const stopA = relay.addSink(() => {});
  const stopB = relay.addSink(() => {});
  stopA();
  assert.equal(relay.isAttached(), true, "one remaining sink keeps the subscription");
  stopB();
  assert.equal(relay.isAttached(), false);
  assert.equal(only.state.detachCount, 1);
});

test("a runtime with no subscribeEvents degrades to unattached rather than throwing", () => {
  const relay = createTuiSessionEventRelay({ currentRuntime: () => ({}), readSubscriber });
  const received: string[] = [];
  relay.addSink((e) => received.push(e.id));
  assert.equal(relay.isAttached(), false);
  relay.reattach();
  assert.deepEqual(received, []);
});

test("a sink unsubscribing during fan-out does not break the dispatch", () => {
  const only = fakeRuntime("only");
  const relay = createTuiSessionEventRelay({ currentRuntime: () => only.runtime, readSubscriber });

  const seen: string[] = [];
  let stopSelf: (() => void) | undefined;
  stopSelf = relay.addSink((e) => {
    seen.push(`a:${e.id}`);
    stopSelf?.();
  });
  relay.addSink((e) => seen.push(`b:${e.id}`));

  only.state.emit(event("e1"));
  assert.deepEqual(seen, ["a:e1", "b:e1"]);
  only.state.emit(event("e2"));
  assert.deepEqual(seen, ["a:e1", "b:e1", "b:e2"]);
});
