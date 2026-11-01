import { setTimeout as delay } from "node:timers/promises";
import { EventEmitter, once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeRelayV2 } from "@origin-ai/cf-shared/testing/fake-relay-v2";
import {
  createWebRemoteControlV2Http,
  WebRemoteControlDeviceTransport,
} from "#src/main/web-remote-relay/index.js";
import { WebSocket } from "ws";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function fixture(
  options: Parameters<typeof createFakeRelayV2>[0] = { users: { jwt: "user" } },
) {
  const relay = await createFakeRelayV2(options);
  cleanups.push(() => relay.close());
  const request = async (path: string, body: unknown) => {
    const response = await fetch(`${relay.httpUrl}/api/v1/remote/${path}`, {
      method: "POST",
      headers: { Authorization: "Bearer jwt", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await response.json();
  };
  const { data: device } = await request("device", { device_mid: "mid-1" });
  const states: string[] = [];
  const stateEvents = new EventEmitter();
  const errors: Error[] = [];
  const transport = new WebRemoteControlDeviceTransport({
    relayWsUrl: relay.wsUrl,
    deviceMid: "mid-1",
    getToken: (signal) => createWebRemoteControlV2Http(relay.httpUrl).token("jwt", signal),
    resolveDeviceSid: async () => device.device_sid,
    meta: { name: "My desktop", platform: "darwin", version: "3.13.0" },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    onStateChange: (state) => {
      states.push(state);
      stateEvents.emit(`state:${state}`);
    },
    onError: (error) => errors.push(error),
    onPayload: vi.fn(),
  });
  cleanups.push(() => transport.dispose());
  const waitForState = async (state: string) => {
    if (states.at(-1) !== state)
      await once(stateEvents, `state:${state}`, { signal: AbortSignal.timeout(5000) });
  };
  return { relay, transport, states, errors, device, request, waitForState };
}

async function settle() {
  await delay(30);
}

describe("desktop relay V2 transport", () => {
  it("用一次性 token 认证，auth_init 仅发送 V2 字段与秒级时间戳", async () => {
    const { relay, transport, states, device } = await fixture();
    transport.start();
    await vi.waitFor(() => expect(states.at(-1)).toBe("waiting_terminal"));
    expect(relay.messages[0]?.message).toEqual({
      type: "auth_init",
      device_sid: device.device_sid,
      meta: { name: "My desktop", platform: "darwin", version: "3.13.0" },
      client_ts: expect.any(Number),
    });
    expect((relay.messages[0]!.message as { client_ts: number }).client_ts).toBeLessThan(1e11);
    expect(relay.httpCalls.filter((call) => call.path.endsWith("/token"))).toHaveLength(1);
  });
  it("4-6s heartbeat per round without SID; independently reconnect and request new token after 15s without ACK", async () => {
    const { relay, transport, states, waitForState } = await fixture({
      users: { jwt: "user" },
      onMessage: ({ message }) =>
        (message as { type: string }).type === "pair_status_query" ? { drop: true } : undefined,
    });
    transport.start();
    await vi.waitFor(() => expect(states.at(-1)).toBe("waiting_terminal"));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    relay.disconnect({ role: "device" });
    await waitForState("connecting");
    await vi.advanceTimersByTimeAsync(1200);
    await waitForState("waiting_terminal");
    expect(states.at(-1)).toBe("waiting_terminal");
    const before = relay.messages.length;
    await vi.advanceTimersByTimeAsync(3999);
    await settle();
    expect(relay.messages).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(2001);
    await settle();
    const query = relay.messages.at(-1)?.message;
    expect(query).toEqual({ type: "pair_status_query", client_ts: expect.any(Number) });
    await vi.advanceTimersByTimeAsync(9000);
    expect(states.at(-1)).toBe("connecting");
    await vi.advanceTimersByTimeAsync(1200);
    await waitForState("waiting_terminal");
    expect(relay.httpCalls.filter((call) => call.path.endsWith("/token"))).toHaveLength(3);
    expect(states.at(-1)).toBe("waiting_terminal");
  });

  it("Recover within 2-5s on first KICKED, stop again within 60s", async () => {
    const { relay, transport, states, waitForState } = await fixture();
    transport.start();
    await vi.waitFor(() => expect(states.at(-1)).toBe("waiting_terminal"));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    relay.sendError({ role: "device" }, "KICKED");
    await waitForState("connecting");
    await vi.advanceTimersByTimeAsync(1999);
    expect(relay.httpCalls.filter((call) => call.path.endsWith("/token"))).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3001);
    await waitForState("waiting_terminal");
    expect(states.at(-1)).toBe("waiting_terminal");
    relay.sendError({ role: "device" }, "KICKED");
    await waitForState("kicked");
    expect(states.at(-1)).toBe("kicked");
    await vi.advanceTimersByTimeAsync(120000);
    await settle();
    expect(relay.httpCalls.filter((call) => call.path.endsWith("/token"))).toHaveLength(2);
  });

  it("Exponential backoff up to 30s for token network and 5xx errors, reset after auth_ack", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    let failure: "network" | "server" | undefined = "server";
    const f = await fixture({
      users: { jwt: "user" },
      onHttp: (call) => {
        if (call.path.endsWith("/token") && failure)
          return failure === "network" ? { networkError: true } : { status: 503 };
      },
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    f.transport.start();
    await settle();
    let count = 1;
    const tokenCalls = () =>
      f.relay.httpCalls.filter((call) => call.path.endsWith("/token")).length;
    for (const ms of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      expect(tokenCalls()).toBe(count);
      await vi.advanceTimersByTimeAsync(ms - 1);
      await settle();
      expect(tokenCalls()).toBe(count);
      await vi.advanceTimersByTimeAsync(1);
      await settle();
      count++;
    }
    failure = undefined;
    await vi.advanceTimersByTimeAsync(30000);
    await f.waitForState("waiting_terminal");
    expect(f.states.at(-1)).toBe("waiting_terminal");
    failure = "network";
    f.relay.disconnect({ role: "device" });
    await settle();
    const before = tokenCalls();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(tokenCalls()).toBe(before + 1);
    expect(f.states.at(-1)).toBe("connecting");
  });

  it.each([401, 403, 429])("Token HTTP %s is a terminal error and will not automatically reconnect", async (status) => {
    const f = await fixture({
      users: { jwt: "user" },
      onHttp: (call) => (call.path.endsWith("/token") ? { status } : undefined),
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    f.transport.start();
    await f.waitForState("error");
    expect(f.states.at(-1)).toBe("error");
    expect(f.errors[0]).toMatchObject({
      reason: status === 401 ? "auth-required" : "relay-unavailable",
    });
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.relay.httpCalls.filter((call) => call.path.endsWith("/token"))).toHaveLength(1);
  });

  it("KICKED after over 60s re-allows one recovery attempt", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const f = await fixture();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    f.transport.start();
    await f.waitForState("waiting_terminal");
    f.relay.sendError({ role: "device" }, "KICKED");
    await f.waitForState("connecting");
    await vi.advanceTimersByTimeAsync(3500);
    await f.waitForState("waiting_terminal");
    vi.setSystemTime(Date.now() + 60000);
    f.relay.sendError({ role: "device" }, "KICKED");
    await f.waitForState("connecting");
    expect(f.states.at(-1)).toBe("connecting");
    await vi.advanceTimersByTimeAsync(3500);
    await f.waitForState("waiting_terminal");
    expect(f.states.at(-1)).toBe("waiting_terminal");
  });

  it("V2配对允许双向payload，terminal断开立即暂停发送并等待再次配对", async () => {
    const f = await fixture();
    f.transport.start();
    await vi.waitFor(() => expect(f.states.at(-1)).toBe("waiting_terminal"));
    expect(f.transport.sendPayload({ cf_type: "bootstrap-request", requestId: "before" })).toBe(
      false,
    );
    const { data } = await f.request("token", { role: "terminal" });
    const terminal = new WebSocket(`${f.relay.wsUrl}?token=${data.token}&mid=mid-1`);
    cleanups.push(() => {
      terminal.close();
    });
    const received: unknown[] = [];
    terminal.on("message", (raw) => received.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve) => terminal.once("open", resolve));
    terminal.send(JSON.stringify({ type: "auth_init", device_sid: f.device.device_sid }));
    await vi.waitFor(() => expect(f.states.at(-1)).toBe("paired"));
    expect(f.transport.sendPayload({ cf_type: "bootstrap-request", requestId: "paired" })).toBe(
      true,
    );
    await vi.waitFor(() =>
      expect(received).toContainEqual(
        expect.objectContaining({
          type: "data",
          payload: { cf_type: "bootstrap-request", requestId: "paired" },
        }),
      ),
    );
    terminal.close();
    await vi.waitFor(() => expect(f.states.at(-1)).toBe("waiting_terminal"));
    expect(f.transport.sendPayload({ cf_type: "bootstrap-request", requestId: "after" })).toBe(
      false,
    );
  });

  it("Resample heartbeat jitter each round, with both 4s lower bound and 6s upper bound observable", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const f = await fixture();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    f.transport.start();
    await f.waitForState("waiting_terminal");
    const queries = () =>
      f.relay.messages.filter(
        ({ message }) => (message as { type: string }).type === "pair_status_query",
      );
    await vi.advanceTimersByTimeAsync(3999);
    await settle();
    expect(queries()).toHaveLength(0);
    random.mockReturnValue(0.999999);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(queries()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5999);
    await settle();
    expect(queries()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(queries()).toHaveLength(2);
  });

  it("Request new token after 15s handshake deadline without ACK", async () => {
    const f = await fixture({ users: { jwt: "user" }, onMessage: () => ({ drop: true }) });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    f.transport.start();
    await f.waitForState("authenticating");
    expect(f.states.at(-1)).toBe("authenticating");
    await vi.advanceTimersByTimeAsync(14999);
    expect(f.states.at(-1)).toBe("authenticating");
    await vi.advanceTimersByTimeAsync(1);
    expect(f.states.at(-1)).toBe("connecting");
    await vi.advanceTimersByTimeAsync(1200);
    await settle();
    expect(f.relay.httpCalls.filter((call) => call.path.endsWith("/token"))).toHaveLength(2);
  });
});
