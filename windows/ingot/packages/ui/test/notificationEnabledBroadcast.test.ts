// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IBroadcastService } from "@origin-ai/cf-services";
import { createCfStore } from "@/store/index.js";

function createBroadcastFixture() {
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
  return { send, service, receive: () => receive };
}

describe("Sync task notification toggle across windows", () => {
  beforeEach(() => localStorage.clear());

  it("Toggling switch broadcasts state:notificationEnabled; other windows apply via broadcast without rebroadcasting", () => {
    const { send, service, receive } = createBroadcastFixture();
    const store = createCfStore(service);
    expect(store.getState().notificationEnabled).toBe(true);

    store.getState().setNotificationEnabled(false);
    expect(store.getState().notificationEnabled).toBe(false);
    expect(send).toHaveBeenCalledWith({ channel: "state:notificationEnabled", payload: false });
    send.mockClear();

    receive()?.({ channel: "state:notificationEnabled", payload: false });
    expect(store.getState().notificationEnabled).toBe(false);
    expect(localStorage.getItem("cf-notification-enabled")).toBe("false");
    expect(send).not.toHaveBeenCalled();

    receive()?.({ channel: "state:notificationEnabled", payload: "unexpected" });
    expect(store.getState().notificationEnabled).toBe(false);
  });

  it("New window launch reads the latest toggle value from localStorage (cross-window shared persistence layer)", () => {
    localStorage.setItem("cf-notification-enabled", "false");
    const { service } = createBroadcastFixture();
    const store = createCfStore(service);
    expect(store.getState().notificationEnabled).toBe(false);
  });
});
