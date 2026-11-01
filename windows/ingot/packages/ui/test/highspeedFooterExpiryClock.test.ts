// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { armHighspeedFooterExpiryClock } from "@/highspeed/highspeedFooterExpiryClock.js";

type Listener = () => void;

function createFakeTargets(initialVisibility: DocumentVisibilityState = "visible") {
  let visibilityState = initialVisibility;
  const timers = new Map<number, Listener>();
  let nextTimerId = 1;
  const docListeners = new Map<string, Set<Listener>>();
  const winListeners = new Map<string, Set<Listener>>();

  const add = (map: Map<string, Set<Listener>>, type: string, listener: Listener) => {
    if (!map.has(type)) map.set(type, new Set());
    map.get(type)!.add(listener);
  };
  const remove = (map: Map<string, Set<Listener>>, type: string, listener: Listener) => {
    map.get(type)?.delete(listener);
  };
  const dispatch = (map: Map<string, Set<Listener>>, type: string) => {
    for (const listener of map.get(type) ?? []) listener();
  };

  const windowTarget = {
    setTimeout: (handler: () => void, _timeout: number) => {
      const id = nextTimerId++;
      timers.set(id, handler);
      return id;
    },
    clearTimeout: (id: number) => {
      timers.delete(id);
    },
    addEventListener: (type: string, listener: Listener) => add(winListeners, type, listener),
    removeEventListener: (type: string, listener: Listener) => remove(winListeners, type, listener),
  };

  const documentTarget = {
    get visibilityState() {
      return visibilityState;
    },
    addEventListener: (type: string, listener: Listener) => add(docListeners, type, listener),
    removeEventListener: (type: string, listener: Listener) => remove(docListeners, type, listener),
  };

  return {
    windowTarget: windowTarget as unknown as Window & typeof globalThis,
    documentTarget: documentTarget as unknown as Document,
    
    fireExpiryTimer() {
      for (const handler of timers.values()) handler();
    },
    hasPendingTimer() {
      return timers.size > 0;
    },
    
    setVisibility(next: DocumentVisibilityState) {
      visibilityState = next;
      dispatch(docListeners, "visibilitychange");
    },
    
    focus() {
      dispatch(winListeners, "focus");
    },
    listenerCount() {
      const count = (map: Map<string, Set<Listener>>) =>
        [...map.values()].reduce((total, set) => total + set.size, 0);
      return count(docListeners) + count(winListeners);
    },
  };
}

describe("armHighspeedFooterExpiryClock", () => {
  it("到期 setTimeout 正常触发时刷新一次 footer 时钟", () => {
    const targets = createFakeTargets();
    const onExpire = vi.fn();
    armHighspeedFooterExpiryClock(1_000, onExpire, {
      windowTarget: targets.windowTarget,
      documentTarget: targets.documentTarget,
      now: () => 0,
    });

    expect(targets.hasPendingTimer()).toBe(true);
    targets.fireExpiryTimer();
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("Compensate refresh when visible after window hidden freezes setTimeout (regression: footer no longer requires user to send another message)", () => {
    const targets = createFakeTargets();
    const onExpire = vi.fn();
    armHighspeedFooterExpiryClock(1_000, onExpire, {
      windowTarget: targets.windowTarget,
      documentTarget: targets.documentTarget,
      now: () => 0,
    });

    targets.setVisibility("hidden");
    expect(onExpire).not.toHaveBeenCalled();

    targets.setVisibility("visible");
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("Also compensate refresh when window gains focus", () => {
    const targets = createFakeTargets();
    const onExpire = vi.fn();
    armHighspeedFooterExpiryClock(1_000, onExpire, {
      windowTarget: targets.windowTarget,
      documentTarget: targets.documentTarget,
      now: () => 0,
    });

    targets.focus();
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("dispose 后清理定时器与监听，窗口唤醒不再触发", () => {
    const targets = createFakeTargets();
    const onExpire = vi.fn();
    const dispose = armHighspeedFooterExpiryClock(1_000, onExpire, {
      windowTarget: targets.windowTarget,
      documentTarget: targets.documentTarget,
      now: () => 0,
    });

    dispose();
    expect(targets.hasPendingTimer()).toBe(false);
    expect(targets.listenerCount()).toBe(0);

    targets.setVisibility("visible");
    targets.focus();
    expect(onExpire).not.toHaveBeenCalled();
  });
});
