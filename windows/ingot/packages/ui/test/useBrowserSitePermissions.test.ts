// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EmbeddedBrowserSitePermissionsSnapshot } from "@origin-ai/cf-shared";
import { useBrowserSitePermissions } from "@/hooks/useBrowserSitePermissions.js";

const h = vi.hoisted(() => ({
  platform: {
    getEmbeddedBrowserSitePermissions: vi.fn(),
    setEmbeddedBrowserSitePermission: vi.fn(),
    resetEmbeddedBrowserSitePermission: vi.fn(),
  },
}));
vi.mock("@/hooks/usePlatform.js", () => ({ usePlatform: () => h.platform }));
const origin = "https://site.test";

beforeEach(() => {
  vi.resetAllMocks();
  h.platform.getEmbeddedBrowserSitePermissions.mockResolvedValue({});
});
afterEach(cleanup);

it("Read全量快照并只投影Target站点；无记录时为空对e", async () => {
  const snapshot: EmbeddedBrowserSitePermissionsSnapshot = {
    "https://other.test": { geolocation: "allow" },
    [origin]: { "clipboard-read": "deny", notifications: "allow" },
  };
  h.platform.getEmbeddedBrowserSitePermissions.mockResolvedValue(snapshot);
  const { result } = renderHook(() => useBrowserSitePermissions(origin, true));
  await waitFor(() => expect(result.current.states).toEqual({
    "clipboard-read": "deny",
    notifications: "allow",
  }));
});

it("失活不Read，切回重读；切换站点后OldResult不残留", async () => {
  const { result, rerender } = renderHook(
    ({ origin, enabled }) => useBrowserSitePermissions(origin, enabled),
    { initialProps: { origin: "https://a.test", enabled: false } },
  );
  expect(h.platform.getEmbeddedBrowserSitePermissions).not.toHaveBeenCalled();
  rerender({ origin: "https://a.test", enabled: true });
  await waitFor(() => expect(result.current.states).toEqual({}));
  h.platform.getEmbeddedBrowserSitePermissions.mockResolvedValue({
    "https://a.test": { midi: "allow" },
  });
  rerender({ origin: "https://b.test", enabled: true });
  await waitFor(() => expect(result.current.states).toEqual({}));
});

it("初次ReadFailedRetry只读，不发出任何Write", async () => {
  h.platform.getEmbeddedBrowserSitePermissions.mockRejectedValueOnce(new Error("read failed"));
  const { result } = renderHook(() => useBrowserSitePermissions(origin, true));
  await act(async () => {});
  expect(result.current.error).toBe(true);
  await act(() => result.current.refresh());
  expect(result.current.error).toBe(false);
  expect(h.platform.setEmbeddedBrowserSitePermission).not.toHaveBeenCalled();
  expect(h.platform.resetEmbeddedBrowserSitePermission).not.toHaveBeenCalled();
});

it.each(["set", "reset"] as const)(
  "%s FailedRetain原操作，普通重读不清除WriteError，显式Retry重发原参Count后成功",
  async (kind) => {
    const writer =
      kind === "set"
        ? h.platform.setEmbeddedBrowserSitePermission
        : h.platform.resetEmbeddedBrowserSitePermission;
    writer.mockRejectedValueOnce(new Error("write failed")).mockResolvedValue({});
    const { result } = renderHook(() => useBrowserSitePermissions(origin, true));
    await act(async () => {});
    await act(() =>
      kind === "set" ? result.current.setPermission("camera", "block") : result.current.reset(),
    );
    expect(result.current.write.status).toBe("failed");
    await act(() => result.current.refresh());
    expect(result.current.write.status).toBe("failed");
    expect(writer).toHaveBeenCalledTimes(1);
    await act(() => result.current.retryWrite());
    expect(writer.mock.calls).toEqual([
      kind === "set"
        ? [{ origin, permission: "camera", state: "deny" }]
        : [{ origin }],
      kind === "set"
        ? [{ origin, permission: "camera", state: "deny" }]
        : [{ origin }],
    ]);
    expect(result.current.write.status).toBe("succeeded");
    expect(result.current.error).toBe(false);
  },
);

it("Write成功后ReadFailed，Retry只读，不重复已成功Write", async () => {
  const { result } = renderHook(() => useBrowserSitePermissions(origin, true));
  await act(async () => {});
  h.platform.getEmbeddedBrowserSitePermissions.mockRejectedValueOnce(new Error("read failed"));
  await act(() => result.current.setPermission("notifications", "allow"));
  expect(result.current.write.status).toBe("succeeded");
  expect(result.current.error).toBe(true);
  await act(() => result.current.refresh());
  expect(h.platform.setEmbeddedBrowserSitePermission).toHaveBeenCalledTimes(1);
  expect(result.current.error).toBe(false);
});

it("Write pending 期间同周期重复Submit只发One次", async () => {
  let release!: (value: EmbeddedBrowserSitePermissionsSnapshot) => void;
  h.platform.setEmbeddedBrowserSitePermission.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const { result } = renderHook(() => useBrowserSitePermissions(origin, true));
  await act(async () => {});
  act(() => {
    void result.current.setPermission("camera", "allow");
    void result.current.setPermission("camera", "allow");
  });
  expect(h.platform.setEmbeddedBrowserSitePermission).toHaveBeenCalledTimes(1);
  await act(async () => {
    release({});
  });
  expect(result.current.write.status).toBe("succeeded");
});

it("站点切换后Old操作的迟到Completed不写New站点Status", async () => {
  let release!: (value: EmbeddedBrowserSitePermissionsSnapshot) => void;
  h.platform.resetEmbeddedBrowserSitePermission.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const { result, rerender } = renderHook(
    ({ origin, enabled }) => useBrowserSitePermissions(origin, enabled),
    { initialProps: { origin: "https://a.test", enabled: true } },
  );
  await act(async () => {});
  act(() => {
    void result.current.reset();
  });
  rerender({ origin: "https://b.test", enabled: true });
  await act(async () => {
    release({});
  });
  expect(result.current.write.status).toBe("idle");
});
