// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IBroadcastService } from "@origin-ai/cf-services";
import { INTERFACE_MODE_STORAGE_KEY, normalizeInterfaceMode } from "@/lib/interfaceMode.js";
import { createCfStore } from "@/store/index.js";

describe("UI mode preference", () => {
  beforeEach(() => localStorage.clear());

  it.each([
    [null, "coding"],
    [undefined, "coding"],
    ["invalid", "coding"],
    ["office", "office"],
    ["coding", "coding"],
    ["general", "office"],
    ["concise", "office"],
    ["professional", "coding"],
  ])("归一化 %s 为 %s", (value, expected) => {
    expect(normalizeInterfaceMode(value)).toBe(expected);
  });

  it("Save mode, sync across windows without echo, do not rewrite code wrap preference", () => {
    let receive: Parameters<IBroadcastService["onMessage"]>[0] | undefined;
    const send = vi.fn(async () => {});
    const service: IBroadcastService = {
      send,
      acquireClaim: async () => ({ status: "unavailable" }),
      commitClaim: async () => {},
      releaseClaim: async () => {},
      tryClaim: async () => false,
      onMessage: (listener) => {
        receive = listener;
        return { dispose: () => {} };
      },
    };
    localStorage.setItem(INTERFACE_MODE_STORAGE_KEY, "office");
    const store = createCfStore(service);
    expect(store.getState().interfaceMode).toBe("office");
    store.getState().setCodePreviewSettings({ wrapLongLines: false });
    store.getState().setInterfaceMode("coding");
    expect(localStorage.getItem(INTERFACE_MODE_STORAGE_KEY)).toBe("coding");
    expect(send).toHaveBeenCalledWith({ channel: "state:interfaceMode", payload: "coding" });
    send.mockClear();
    receive?.({ channel: "state:interfaceMode", payload: "office" });
    expect(store.getState().interfaceMode).toBe("office");
    expect(localStorage.getItem(INTERFACE_MODE_STORAGE_KEY)).toBe("office");
    expect(store.getState().codePreviewSettings.wrapLongLines).toBe(false);
    expect(send).not.toHaveBeenCalled();
    receive?.({ channel: "state:interfaceMode", payload: "unexpected" });
    expect(store.getState().interfaceMode).toBe("office");
  });
});
