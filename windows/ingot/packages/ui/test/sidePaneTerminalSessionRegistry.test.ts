// @vitest-environment jsdom
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal as XTerm } from "@xterm/xterm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  sidePaneTerminalSessionRegistry as registry,
  type SidePaneTerminalSessionEntry,
} from "@/terminal/sidePaneTerminalSessionRegistry.js";

function createMockEntry(
  key: string,
  cwd = "/test",
  workspaceKey = cwd,
): SidePaneTerminalSessionEntry {
  return {
    key,
    term: { dispose: vi.fn() } as unknown as XTerm,
    fitAddon: { fit: vi.fn() } as unknown as FitAddon,
    terminalId: `pty-${key}`,
    cwd,
    workspaceKey,
    hostEl: document.createElement("div"),
    dispose: vi.fn(),
  };
}

describe("sidePaneTerminalSessionRegistry", () => {
  beforeEach(() => {
    registry.clearForTest();
  });

  it("get/has misses when unregistered", () => {
    expect(registry.has("missing")).toBe(false);
    expect(registry.get("missing")).toBeUndefined();
  });

  it("attachDom 把 hostEl 移入 host 容器", () => {
    const entry = createMockEntry("t1");
    registry.register("t1", entry);
    const host = document.createElement("div");
    registry.attachDom("t1", host);
    expect(entry.hostEl.parentElement).toBe(host);
  });

  it("attachDom miss 不抛（key 未注册）", () => {
    const host = document.createElement("div");
    expect(() => registry.attachDom("missing", host)).not.toThrow();
  });

  it("detachDom 把 hostEl 移回 stashDiv", () => {
    const entry = createMockEntry("t1");
    registry.register("t1", entry);
    const host = document.createElement("div");
    registry.attachDom("t1", host);
    registry.detachDom("t1");
    expect(entry.hostEl.parentElement).not.toBe(host);
    expect(entry.hostEl.parentElement?.getAttribute("data-side-pane-terminal-stash")).toBe("");
  });

  it("detachDom does not delete entry — core to keep-alive across workspace switches", () => {
    const entry = createMockEntry("t1");
    registry.register("t1", entry);
    registry.detachDom("t1");
    expect(registry.has("t1")).toBe(true);
    expect(registry.get("t1")?.term).toBe(entry.term);
  });

  it("detach does not dispose (retains resources for re-attach reuse)", () => {
    const entry = createMockEntry("t1");
    registry.register("t1", entry);
    registry.detachDom("t1");
    expect(entry.dispose).not.toHaveBeenCalled();
  });

  it("attach reuses the same entry/hostEl after detach (simulating switching back to workspace)", () => {
    const entry = createMockEntry("t1");
    registry.register("t1", entry);
    const host1 = document.createElement("div");
    registry.attachDom("t1", host1);
    registry.detachDom("t1");
    const host2 = document.createElement("div");
    registry.attachDom("t1", host2);
    expect(registry.get("t1")?.hostEl).toBe(entry.hostEl);
    expect(entry.hostEl.parentElement).toBe(host2);
  });

  it("release calls dispose + deletes entry (explicit tab close cleanup)", () => {
    const entry = createMockEntry("t1");
    registry.register("t1", entry);
    registry.release("t1");
    expect(registry.has("t1")).toBe(false);
    expect(entry.dispose).toHaveBeenCalledTimes(1);
  });

  it("hostEl is removed from DOM after release", () => {
    const entry = createMockEntry("t1");
    registry.register("t1", entry);
    const host = document.createElement("div");
    registry.attachDom("t1", host);
    registry.release("t1");
    expect(entry.hostEl.parentElement).toBeNull();
  });

  it("release is safe for unregistered keys (does not throw)", () => {
    expect(() => registry.release("missing")).not.toThrow();
  });

  it("releaseByPredicate batch cleans up matched entries (workspace close cleanup)", () => {
    const e1 = createMockEntry("t1", "/ws-a", "ws-a");
    const e2 = createMockEntry("t2", "/ws-b", "ws-b");
    const e3 = createMockEntry("t3", "/ws-a", "ws-a");
    registry.register("t1", e1);
    registry.register("t2", e2);
    registry.register("t3", e3);
    const retained = new Set(["ws-b"]);
    registry.releaseByPredicate(
      (entry) => Boolean(entry.workspaceKey) && !retained.has(entry.workspaceKey),
    );
    expect(registry.has("t1")).toBe(false);
    expect(registry.has("t3")).toBe(false);
    expect(registry.has("t2")).toBe(true);
    expect(e1.dispose).toHaveBeenCalledTimes(1);
    expect(e3.dispose).toHaveBeenCalledTimes(1);
    expect(e2.dispose).not.toHaveBeenCalled();
  });
});
