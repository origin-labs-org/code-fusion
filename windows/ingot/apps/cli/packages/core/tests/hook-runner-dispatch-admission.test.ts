import { describe, expect, it } from "vitest";
import {
  HookEventName,
  SessionEventType,
  createSessionId,
  createTraceId,
  createTurnId,
  type HookExecutionDescriptor,
  type HookRunLifecyclePayload,
  type SessionEvent,
} from "@origin-ai/cf-contracts";
import { createInMemoryHookRunner } from "../src/hooks/index.js";
import type { HookInput } from "../src/hooks/types.js";

const visibleDescriptor: HookExecutionDescriptor = {
  clientVisible: true,
  commandDisplay: "hook-command",
  executionMode: "foreground",
  executionType: "process",
  sourceKind: "user",
  sourcePath: "/Users/example/.cf/cli/config.json",
  timeoutMs: 60_000,
};

function promptInput(): HookInput {
  return {
    cwd: "/workspace",
    hookEventName: HookEventName.UserPromptSubmit,
    mode: "build",
    prompt: "hello",
    sessionId: createSessionId("hook-dispatch-admission"),
    timestamp: new Date().toISOString(),
    traceId: createTraceId(),
    turnId: createTurnId("turn-1"),
  } as HookInput;
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("Hook runner dispatch-time admission（CR-01）", () => {
  it("前序 Hook 运行中 revoke 后续 Hook：后续 Hook 必须 Blocked 且 callback 不执行", async () => {
    const events: SessionEvent[] = [];
    const hook1Started = deferred<void>();
    const releaseHook1 = deferred<void>();
    let secondHookAllowed = true;
    let secondHookCallbackRan = false;

    const runner = createInMemoryHookRunner({
      emitEvent: async (event) => {
        events.push(event);
      },
      hooks: [
        {
          callback: async () => {
            hook1Started.resolve();
            await releaseHook1.promise;
            return undefined;
          },
          descriptor: visibleDescriptor,
          event: HookEventName.UserPromptSubmit,
        },
        {
          admission: () => ({
            allowed: secondHookAllowed,
            reasonCode: secondHookAllowed ? undefined : "workspace_hooks_trust_revoked",
          }),
          callback: () => {
            secondHookCallbackRan = true;
            return undefined;
          },
          descriptor: visibleDescriptor,
          event: HookEventName.UserPromptSubmit,
        },
      ],
    });

    const runPromise = runner.run(promptInput());
    await hook1Started.promise;
    secondHookAllowed = false;
    releaseHook1.resolve();
    await runPromise;

    expect(secondHookCallbackRan).toBe(false);

    const secondHookEvents = events.filter(
      (event) => (event.payload as HookRunLifecyclePayload).hookIndex === 1,
    );
    expect(secondHookEvents.map((event) => event.type)).toEqual([SessionEventType.HookRunBlocked]);
    expect((secondHookEvents[0]!.payload as HookRunLifecyclePayload).errorCode).toBe(
      "workspace_hooks_trust_revoked",
    );
    expect((secondHookEvents[0]!.payload as HookRunLifecyclePayload).blockReason).toBe(
      "workspace_hooks_trust_revoked",
    );
  });

  it("Policy tightened to \'deny\' while a previous Hook is running: unstarted asynchronous Hooks must not create tasks", async () => {
    const events: SessionEvent[] = [];
    const hook1Started = deferred<void>();
    const releaseHook1 = deferred<void>();
    let policyDeny = false;
    let asyncHookCallbackRan = false;

    const runner = createInMemoryHookRunner({
      emitEvent: async (event) => {
        events.push(event);
      },
      hooks: [
        {
          callback: async () => {
            hook1Started.resolve();
            await releaseHook1.promise;
            return undefined;
          },
          descriptor: visibleDescriptor,
          event: HookEventName.UserPromptSubmit,
        },
        {
          admission: () => ({
            allowed: !policyDeny,
            reasonCode: policyDeny ? "workspace_hooks_blocked_by_policy" : undefined,
          }),
          async: true,
          callback: () => {
            asyncHookCallbackRan = true;
            return undefined;
          },
          descriptor: { ...visibleDescriptor, executionMode: "background" },
          event: HookEventName.UserPromptSubmit,
        },
      ],
    });

    const runPromise = runner.run(promptInput());
    await hook1Started.promise;
    policyDeny = true;
    releaseHook1.resolve();
    await runPromise;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(asyncHookCallbackRan).toBe(false);
    const asyncHookEvents = events.filter(
      (event) => (event.payload as HookRunLifecyclePayload).hookIndex === 1,
    );
    expect(asyncHookEvents.map((event) => event.type)).toEqual([SessionEventType.HookRunBlocked]);
    expect((asyncHookEvents[0]!.payload as HookRunLifecyclePayload).errorCode).toBe(
      "workspace_hooks_blocked_by_policy",
    );
    expect((asyncHookEvents[0]!.payload as HookRunLifecyclePayload).blockReason).toBe(
      "workspace_hooks_blocked_by_policy",
    );
  });

  it("预扫描仍负责 skipLifecycle 剔除与 hookCount（H1 行为不回归）", async () => {
    const events: SessionEvent[] = [];
    const runner = createInMemoryHookRunner({
      emitEvent: async (event) => {
        events.push(event);
      },
      hooks: [
        {
          admission: () => ({ allowed: false, skipLifecycle: true }),
          callback: () => undefined,
          descriptor: visibleDescriptor,
          event: HookEventName.UserPromptSubmit,
        },
        {
          callback: () => undefined,
          descriptor: visibleDescriptor,
          event: HookEventName.UserPromptSubmit,
        },
      ],
    });

    await runner.run(promptInput());

    const lifecycleEvents = events.filter(
      (event) => event.type === SessionEventType.HookRunStarted,
    );
    expect(lifecycleEvents).toHaveLength(1);
    expect((lifecycleEvents[0]!.payload as HookRunLifecyclePayload).hookCount).toBe(1);
  });
});
