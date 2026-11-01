import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DRAFT_RUNTIME_REBUILD_GATE_IDLE,
  DRAFT_RUNTIME_REBUILD_TIMEOUT_MS,
  reduceDraftRuntimeRebuildGate,
  useDraftRuntimeRebuildGate,
  type DraftRuntimeRebuildGate,
} from "@/v4/composer/useDraftRuntimeRebuildGate.js";

const mocks = vi.hoisted(() => ({
  invalidateDraftRuntime: vi.fn(),
}));

vi.mock("@/store/cfSessionStore.js", () => ({
  useCfSessionStore: {
    getState: () => ({ invalidateDraftRuntime: mocks.invalidateDraftRuntime }),
  },
}));

function createMinimalElement(ownerDocument: Document, tagName = "div") {
  const element = {
    addEventListener: () => {},
    appendChild: (child: { parentNode?: unknown }) => {
      child.parentNode = element;
      return child;
    },
    childNodes: [] as unknown[],
    getAttribute: () => null,
    insertBefore: (child: { parentNode?: unknown }) => {
      child.parentNode = element;
      return child;
    },
    nodeName: tagName.toUpperCase(),
    nodeType: 1,
    ownerDocument,
    parentNode: null as unknown,
    removeAttribute: () => {},
    removeChild: (child: { parentNode?: unknown }) => {
      child.parentNode = null;
      return child;
    },
    removeEventListener: () => {},
    setAttribute: () => {},
    style: {
      removeProperty: () => {},
      setProperty: () => {},
    },
    tagName: tagName.toUpperCase(),
  };
  return element as unknown as Element;
}

function installMinimalDom() {
  const documentMock = {
    addEventListener: () => {},
    createElement: (tagName: string) =>
      createMinimalElement(documentMock as unknown as Document, tagName),
    createTextNode: (nodeValue: string) => ({
      nodeType: 3,
      nodeValue,
      ownerDocument: documentMock,
      parentNode: null,
    }),
    nodeType: 9,
    removeEventListener: () => {},
  } as unknown as Document;
  const windowMock = {
    addEventListener: () => {},
    document: documentMock,
    HTMLIFrameElement: function HTMLIFrameElement() {},
    HTMLElement: function HTMLElement() {},
    Node: function Node() {},
    removeEventListener: () => {},
  };
  Object.defineProperty(globalThis, "document", { configurable: true, value: documentMock });
  Object.defineProperty(globalThis, "window", { configurable: true, value: windowMock });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });
  return createMinimalElement(documentMock, "div");
}

const mountedRoots: Root[] = [];

interface ProbeOptions {
  enabled: boolean;
  prewarmSessionId: string | null;
  onRuntimeRestart?: (listener: () => void) => () => void;
  onRuntimeLifecycle?: (listener: (state: "available" | "unavailable") => void) => () => void;
}

let latest: DraftRuntimeRebuildGate | null = null;

function Probe(options: ProbeOptions) {
  latest = useDraftRuntimeRebuildGate({
    enabled: options.enabled,
    onRuntimeRestart: options.onRuntimeRestart,
    onRuntimeLifecycle: options.onRuntimeLifecycle,
    prewarmSessionId: options.prewarmSessionId,
    workspacePath: "/workspace",
  });
  return null;
}

function renderProbe(options: ProbeOptions) {
  const root = createRoot(installMinimalDom());
  mountedRoots.push(root);
  act(() => root.render(createElement(Probe, options)));
  return {
    rerender(next: ProbeOptions) {
      act(() => root.render(createElement(Probe, next)));
    },
  };
}

function createRestartHook() {
  const listeners = new Set<() => void>();
  return {
    fire() {
      act(() => {
        for (const listener of [...listeners]) listener();
      });
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function createLifecycleHook() {
  const listeners = new Set<(state: "available" | "unavailable") => void>();
  return {
    fire(state: "available" | "unavailable") {
      act(() => {
        for (const listener of [...listeners]) listener(state);
      });
    },
    subscribe: (listener: (state: "available" | "unavailable") => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

beforeEach(() => {
  latest = null;
  mocks.invalidateDraftRuntime.mockReset();
});

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => root.unmount());
  }
  vi.useRealTimers();
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT;
});

describe("reduceDraftRuntimeRebuildGate", () => {
  it("换代 → 进入 rebuilding 并记住换代时的Session id", () => {
    const next = reduceDraftRuntimeRebuildGate(DRAFT_RUNTIME_REBUILD_GATE_IDLE, {
      prewarmSessionId: "draft-1",
      type: "runtimeRestart",
    });
    expect(next.rebuilding).toBe(true);
    expect(next.pendingFrom).toBe("draft-1");
    expect(next.epoch).toBe(1);
  });

  it("NewSession到达 → 回到空闲", () => {
    const rebuilding = reduceDraftRuntimeRebuildGate(DRAFT_RUNTIME_REBUILD_GATE_IDLE, {
      prewarmSessionId: "draft-1",
      type: "runtimeRestart",
    });
    const next = reduceDraftRuntimeRebuildGate(rebuilding, {
      prewarmSessionId: "draft-2",
      type: "prewarmSessionChanged",
    });
    expect(next.rebuilding).toBe(false);
    expect(next.pendingFrom).toBeNull();
  });

  it("Session id 未变or暂时为空 → 保持 rebuilding", () => {
    const rebuilding = reduceDraftRuntimeRebuildGate(DRAFT_RUNTIME_REBUILD_GATE_IDLE, {
      prewarmSessionId: "draft-1",
      type: "runtimeRestart",
    });
    expect(
      reduceDraftRuntimeRebuildGate(rebuilding, {
        prewarmSessionId: "draft-1",
        type: "prewarmSessionChanged",
      }).rebuilding,
    ).toBe(true);
    expect(
      reduceDraftRuntimeRebuildGate(rebuilding, {
        prewarmSessionId: null,
        type: "prewarmSessionChanged",
      }).rebuilding,
    ).toBe(true);
  });

  it("超时 → 解除门禁但Retain pendingFrom（重建仍在进行）", () => {
    const rebuilding = reduceDraftRuntimeRebuildGate(DRAFT_RUNTIME_REBUILD_GATE_IDLE, {
      prewarmSessionId: "draft-1",
      type: "runtimeRestart",
    });
    const next = reduceDraftRuntimeRebuildGate(rebuilding, { type: "rebuildTimeout" });
    expect(next.rebuilding).toBe(false);
    expect(next.pendingFrom).toBe("draft-1");
  });

  it("空闲态收到超时 → Status不变（同One对e）", () => {
    expect(
      reduceDraftRuntimeRebuildGate(DRAFT_RUNTIME_REBUILD_GATE_IDLE, { type: "rebuildTimeout" }),
    ).toBe(DRAFT_RUNTIME_REBUILD_GATE_IDLE);
  });

  it("重建Medium再次换代 → epoch 递增，用于Reset计时器", () => {
    const first = reduceDraftRuntimeRebuildGate(DRAFT_RUNTIME_REBUILD_GATE_IDLE, {
      prewarmSessionId: "draft-1",
      type: "runtimeRestart",
    });
    const second = reduceDraftRuntimeRebuildGate(first, {
      prewarmSessionId: null,
      type: "runtimeRestart",
    });
    expect(second.epoch).toBe(2);
    expect(second.rebuilding).toBe(true);
  });
});

describe("useDraftRuntimeRebuildGate", () => {
  it("Draft态换代 → 触发 invalidateDraftRuntime 并禁用Send", () => {
    const restart = createRestartHook();
    renderProbe({ enabled: true, onRuntimeRestart: restart.subscribe, prewarmSessionId: "draft-1" });

    expect(latest?.rebuilding).toBe(false);
    restart.fire();

    expect(mocks.invalidateDraftRuntime).toHaveBeenCalledWith("/workspace", undefined);
    expect(latest?.rebuilding).toBe(true);
  });

  it("非Draft态换代 → 不触发 invalidate，不禁用Send", () => {
    const restart = createRestartHook();
    renderProbe({ enabled: false, onRuntimeRestart: restart.subscribe, prewarmSessionId: null });
    restart.fire();

    expect(mocks.invalidateDraftRuntime).not.toHaveBeenCalled();
    expect(latest?.rebuilding).toBe(false);
  });

  it("New预热Session到达 → 解除禁用", () => {
    const restart = createRestartHook();
    const probe = renderProbe({
      enabled: true,
      onRuntimeRestart: restart.subscribe,
      prewarmSessionId: "draft-1",
    });
    restart.fire();
    expect(latest?.rebuilding).toBe(true);

    probe.rerender({
      enabled: true,
      onRuntimeRestart: restart.subscribe,
      prewarmSessionId: "draft-2",
    });

    expect(latest?.rebuilding).toBe(false);
  });

  it("超时未重建 → 解除禁用回落无预热Send", () => {
    vi.useFakeTimers();
    const restart = createRestartHook();
    renderProbe({ enabled: true, onRuntimeRestart: restart.subscribe, prewarmSessionId: "draft-1" });
    restart.fire();
    expect(latest?.rebuilding).toBe(true);

    act(() => {
      vi.advanceTimersByTime(DRAFT_RUNTIME_REBUILD_TIMEOUT_MS);
    });

    expect(latest?.rebuilding).toBe(false);
  });

  it("重建Medium再次换代 → 计时器Reset，不提前解除", () => {
    vi.useFakeTimers();
    const restart = createRestartHook();
    renderProbe({ enabled: true, onRuntimeRestart: restart.subscribe, prewarmSessionId: "draft-1" });
    restart.fire();

    act(() => {
      vi.advanceTimersByTime(DRAFT_RUNTIME_REBUILD_TIMEOUT_MS - 1000);
    });
    restart.fire();
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(latest?.rebuilding).toBe(true);
  });

  it("lifecycle unavailable → dispose 当场就触发重建，不等New进程 spawn", () => {
    const lifecycle = createLifecycleHook();
    renderProbe({
      enabled: true,
      onRuntimeLifecycle: lifecycle.subscribe,
      prewarmSessionId: "draft-1",
    });

    expect(latest?.rebuilding).toBe(false);
    lifecycle.fire("unavailable");

    expect(mocks.invalidateDraftRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateDraftRuntime).toHaveBeenCalledWith("/workspace", undefined);
    expect(latest?.rebuilding).toBe(true);
  });

  it("unavailable 之后的 available → 不再重复 invalidate（否则白建One代预热Session）", () => {
    const lifecycle = createLifecycleHook();
    renderProbe({
      enabled: true,
      onRuntimeLifecycle: lifecycle.subscribe,
      prewarmSessionId: "draft-1",
    });

    lifecycle.fire("unavailable");
    lifecycle.fire("available");

    expect(mocks.invalidateDraftRuntime).toHaveBeenCalledTimes(1);
    expect(latest?.rebuilding).toBe(true);
  });

  it("两条通道都在时只订阅 lifecycle：restart Events不再Two次触发重建", () => {
    const lifecycle = createLifecycleHook();
    const restart = createRestartHook();
    renderProbe({
      enabled: true,
      onRuntimeLifecycle: lifecycle.subscribe,
      onRuntimeRestart: restart.subscribe,
      prewarmSessionId: "draft-1",
    });

    lifecycle.fire("unavailable");
    restart.fire();

    expect(mocks.invalidateDraftRuntime).toHaveBeenCalledTimes(1);
  });

  it("非Draft态收到 unavailable → 不触发 invalidate", () => {
    const lifecycle = createLifecycleHook();
    renderProbe({
      enabled: false,
      onRuntimeLifecycle: lifecycle.subscribe,
      prewarmSessionId: null,
    });
    lifecycle.fire("unavailable");

    expect(mocks.invalidateDraftRuntime).not.toHaveBeenCalled();
    expect(latest?.rebuilding).toBe(false);
  });
});
