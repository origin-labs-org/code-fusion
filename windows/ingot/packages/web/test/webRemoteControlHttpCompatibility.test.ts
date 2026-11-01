import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWebRemoteControlDeviceClient,
  createWebRemoteControlV2TokenClient,
} from "#src/web-remote-control/index.js";

const apiDescriptors = Object.getOwnPropertyDescriptors(AbortSignal);
const token = "AAAAAAAAAAAAAAAAAAAAAA";
const devices = [{ device_sid: "sid", device_mid: "mid", online: true, created_at: 1, meta: {} }];

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  Object.defineProperties(AbortSignal, apiDescriptors);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each([
  {
    name: "terminal token",
    createClient: createWebRemoteControlV2TokenClient,
    data: { token, expires_in: 60 },
    expected: token,
    retryable: true,
  },
  {
    name: "device list",
    createClient: createWebRemoteControlDeviceClient,
    data: devices,
    expected: devices,
    retryable: false,
  },
])("$name HTTP Compatible与RequestScope", ({ createClient, data, expected, retryable }) => {
  it.each([["any"], ["timeout"], ["any", "timeout"]])(
    "Missing静态 API %j 时真正Request并BackCompleteResult",
    async (...missing) => {
      for (const name of missing)
        Object.defineProperty(AbortSignal, name, { configurable: true, value: undefined });
      const fetcher = vi.fn<typeof fetch>(async () => Response.json({ code: 0, msg: "", data }));
      const client = createClient("https://relay.example", fetcher);
      await expect(client("jwt", new AbortController().signal)).resolves.toEqual(expected);
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it("Canceled的调用方不Start HTTP Requestor遗留资源", async () => {
    const controller = new AbortController();
    controller.abort();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ code: 0, msg: "", data }));
    await expect(
      createClient("https://relay.example", fetcher)("jwt", controller.signal),
    ).rejects.toMatchObject({ reason: "relay-unavailable", retryable });
    expect(fetcher).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("提前Deny HTTP Status时End止尚Ongoing的Body", async () => {
    const interrupted = vi.fn();
    const fetcher: typeof fetch = async (_url, init) =>
      new Response(
        new ReadableStream({
          start(body) {
            init?.signal?.addEventListener(
              "abort",
              () => {
                interrupted();
                body.error(init.signal?.reason);
              },
              { once: true },
            );
          },
        }),
        { status: 401 },
      );
    await expect(
      createClient("https://relay.example", fetcher)("jwt", new AbortController().signal),
    ).rejects.toMatchObject({ reason: "auth-required", retryable: false });
    expect(interrupted).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["success", "http", "business", "invalid-json", "network"])(
    "%s 结束后清理期限and调用方监听，不改变Error分类",
    async (outcome) => {
      const controller = new AbortController();
      const add = vi.spyOn(controller.signal, "addEventListener");
      const remove = vi.spyOn(controller.signal, "removeEventListener");
      let requestSignal: AbortSignal | null | undefined;
      const fetcher: typeof fetch = async (_url, init) => {
        requestSignal = init?.signal;
        if (outcome === "network") throw new TypeError("private network detail");
        if (outcome === "http") return new Response("private response", { status: 401 });
        if (outcome === "invalid-json") return new Response("not-json");
        return Response.json({ code: outcome === "business" ? 1006 : 0, msg: "", data });
      };
      const result = createClient("https://relay.example", fetcher)("jwt", controller.signal);
      if (outcome === "success") await expect(result).resolves.toEqual(expected);
      else {
        const reason = outcome === "http" ? "auth-required" : "relay-unavailable";
        await expect(result).rejects.toMatchObject({
          reason,
          message: reason,
          retryable: outcome === "network" && retryable,
        });
      }
      expect(add).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0]?.[1]);
      expect(vi.getTimerCount()).toBe(0);
      controller.abort();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(requestSignal?.aborted).toBe(outcome !== "success");
    },
  );

  it.each([
    ["headers", "cancel"],
    ["headers", "timeout"],
    ["body", "cancel"],
    ["body", "timeout"],
  ])("%s Phase的 %s Medium断实际Request并清理资源", async (phase, action) => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    let requestSignal: AbortSignal | null | undefined;
    const fetcher: typeof fetch = async (_url, init) => {
      const signal = init?.signal;
      if (!signal) throw new Error("Missing request signal");
      requestSignal = signal;
      if (phase === "headers")
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      return new Response(
        new ReadableStream({
          start(body) {
            body.enqueue(new TextEncoder().encode('{"code":0,"data":'));
            signal.addEventListener("abort", () => body.error(signal.reason), { once: true });
          },
        }),
      );
    };
    const result = createClient("https://relay.example", fetcher)("jwt", controller.signal);
    const rejected = expect(result).rejects.toMatchObject({
      reason: "relay-unavailable",
      message: "relay-unavailable",
      retryable,
    });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(requestSignal?.aborted).toBe(false);
    if (action === "cancel") controller.abort(new DOMException("navigation ended", "AbortError"));
    else await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(requestSignal?.aborted).toBe(true);
    expect(requestSignal?.reason.name).toBe(action === "cancel" ? "AbortError" : "TimeoutError");
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0]?.[1]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
