import { describe, expect, it, vi } from "vitest";
import {
  WebRemoteControlV2ConnectionError,
  type WebRemoteControlRelayV2Device,
} from "@origin-ai/cf-shared/web-remote-relay";
import {
  WebRemoteControlEntry,
  type WebRemoteControlDeviceListAccount,
} from "#src/web-remote-control/index.js";

function setup(
  jwt: string | null = null,
  href = "https://cf.z.ai/remote/v4?app_version=3.13.0&sid=device-1&mid=mid-1&name=Desktop",
  account: WebRemoteControlDeviceListAccount | null = null,
) {
  const auth = {
    getCfJwtToken: () => jwt,
    getActiveAccount: vi.fn(() => (jwt ? account : null)),
    startLogin: vi.fn(),
    logout: vi.fn(async () => {
      jwt = null;
    }),
  };
  const token = vi.fn(async () => "one-use-token");
  const connect = vi.fn();
  const onView = vi.fn();
  const devices = vi.fn<
    (jwt: string, signal: AbortSignal) => Promise<WebRemoteControlRelayV2Device[]>
  >(async () => []);
  const storage = new Map<string, string>();
  let visible: (() => void) | undefined;
  const storageAdapter = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
  };
  const entry = new WebRemoteControlEntry({
    auth,
    token,
    connect,
    onView,
    getHref: () => href,
    devices,
    replaceHref: (next) => {
      href = next;
    },
    storage: storageAdapter,
    locale: "en-US",
    subscribeVisible: (listener) => {
      visible = listener;
      return () => {
        visible = undefined;
      };
    },
  });
  return {
    entry,
    auth,
    token,
    connect,
    onView,
    devices,
    storage,
    storageAdapter,
    setJwt: (value: string | null) => {
      jwt = value;
    },
    show: () => visible?.(),
    get href() {
      return href;
    },
  };
}

describe("V2 手机入口", () => {
  it("无 JWT 先登录，RetainComplete扫码 URL 且不建连", async () => {
    const h = setup();
    await h.entry.start();
    expect(h.onView).toHaveBeenLastCalledWith({ kind: "login" });
    expect(h.connect).not.toHaveBeenCalled();
    expect(h.token).not.toHaveBeenCalled();
    h.entry.startLogin();
    expect(h.auth.startLogin).toHaveBeenCalledWith({ appReturnTo: h.href });
  });
  it.each(["zai", "bigmodel"] as const)(
    "扫码登录透传所选平台 %s 并RetainBack地址",
    async (provider) => {
      const h = setup();
      await h.entry.start();
      h.entry.startLogin(provider);
      expect(h.auth.startLogin).toHaveBeenCalledWith({ provider, appReturnTo: h.href });
      expect(h.connect).not.toHaveBeenCalled();
      expect(h.token).not.toHaveBeenCalled();
    },
  );
  it.each([
    "code=code-1&state=state-1",
    "authCode=bigmodel-code&state=state-1",
    "error=access_denied&state=state-1",
  ])("回调优先于登录门禁：%s", async (query) => {
    const h = setup(null, `https://cf.z.ai/remote/v4/?${query}`);
    await h.entry.start();
    expect(h.onView).toHaveBeenCalledWith({ kind: "callback" });
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("已登录但无 SID 拉Current账NumberDevice，空list不建连", async () => {
    const h = setup("jwt", "https://cf.z.ai/remote/v4");
    await h.entry.start();
    expect(h.onView).toHaveBeenLastCalledWith({
      kind: "devices",
      devices: [],
      loading: false,
      error: false,
    });
    expect(h.devices).toHaveBeenCalledWith("jwt", expect.any(AbortSignal));
    expect(h.token).not.toHaveBeenCalled();
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("有 SID 直接Connect；每次Request token 都重New读登录态", async () => {
    const h = setup("jwt");
    await h.entry.start();
    const connection = h.connect.mock.calls[0][0];
    expect(connection.params).toEqual({
      deviceSid: "device-1",
      deviceMid: "mid-1",
      deviceName: "Desktop",
      appVersion: "3.13.0",
    });
    const signal = new AbortController().signal;
    expect(await connection.getToken(signal)).toBe("one-use-token");
    expect(h.token).toHaveBeenCalledWith("jwt", signal);
    await h.auth.logout();
    await expect(connection.getToken(signal)).rejects.toMatchObject({ reason: "auth-required" });
  });

  it("401 清Session回登录；账Number不匹配RetainFailed页直至User切换账Number", async () => {
    const h = setup("jwt");
    await h.entry.start();
    const connection = h.connect.mock.calls[0][0];
    connection.onFailure({ reason: "device-not-owned" });
    expect(h.onView).toHaveBeenLastCalledWith({
      kind: "failure",
      failure: { reason: "device-not-owned" },
    });
    expect(h.auth.logout).not.toHaveBeenCalled();
    await h.entry.switchAccount();
    expect(h.onView).toHaveBeenLastCalledWith({ kind: "login" });
    h.entry.startLogin();
    expect(h.auth.startLogin).toHaveBeenLastCalledWith({ appReturnTo: h.href });
    connection.onFailure({ reason: "auth-required" });
    await Promise.resolve();
    expect(h.onView).toHaveBeenLastCalledWith({ kind: "login" });
  });

  it("Deny V1 hash/t，不能Continue尝试Connect", async () => {
    const h = setup("jwt", "https://cf.z.ai/remote/v4?sid=device-1&hash=secret&t=1");
    await h.entry.start();
    expect(h.onView).toHaveBeenCalledWith({
      kind: "failure",
      failure: { reason: "invalid-mobile-connection" },
    });
    expect(h.connect).not.toHaveBeenCalled();
  });
});

const onlineDevice: WebRemoteControlRelayV2Device = {
  device_sid: "last-device",
  device_mid: "abcdefgh-1234",
  online: true,
  created_at: 1,
  meta: { name: "Alice’s MacBook" },
};

const singleOnlineGroup = (device: WebRemoteControlRelayV2Device) => ({
  deviceMid: device.device_mid,
  name: device.meta.name,
  onlineConnections: [device],
});

it("同OneComplete MID 的 1 Onlineand 11 条历史Offline注册只展示One个Device，Connect仍选原 SID", async () => {
  const h = setup("jwt", "https://cf.z.ai/remote/v4");
  const offline = Array.from({ length: 11 }, (_, index) => ({
    ...onlineDevice,
    device_sid: `history-${index}`,
    online: false,
    meta: {},
  }));
  h.devices.mockResolvedValue([...offline, onlineDevice]);
  await h.entry.start();
  expect(h.onView.mock.lastCall[0].devices).toEqual([
    {
      deviceMid: onlineDevice.device_mid,
      name: "Alice’s MacBook",
      onlineConnections: [onlineDevice],
    },
  ]);
  await h.entry.refreshDevices();
  expect(h.onView.mock.lastCall[0].devices).toHaveLength(1);
  h.entry.selectDevice("history-0");
  expect(h.connect).not.toHaveBeenCalled();
  h.entry.selectDevice("last-device");
  expect(h.connect.mock.lastCall[0].params.deviceSid).toBe("last-device");
});

it("同 MID 全Offline只展示One项，Complete MID 不同但前八位E同的Device不能合并", async () => {
  const h = setup("jwt", "https://cf.z.ai/remote/v4");
  h.devices.mockResolvedValue([
    { ...onlineDevice, online: false, meta: {} },
    { ...onlineDevice, device_sid: "history", online: false, meta: {} },
    {
      ...onlineDevice,
      device_sid: "another",
      device_mid: "abcdefgh-5678",
      online: false,
      meta: {},
    },
  ]);
  await h.entry.start();
  expect(h.onView.mock.lastCall[0].devices).toEqual([
    { deviceMid: "abcdefgh-1234", name: undefined, onlineConnections: [] },
    { deviceMid: "abcdefgh-5678", name: undefined, onlineConnections: [] },
  ]);
  h.entry.selectDevice("last-device");
  expect(h.connect).not.toHaveBeenCalled();
});

it("多个Online SID Retain在同OneDevice项inner，任意Connect都可被明确选择且Refresh后OldConnectInvalid", async () => {
  const h = setup("jwt", "https://cf.z.ai/remote/v4?app_version=3.13.0");
  const other = { ...onlineDevice, device_sid: "other", meta: { name: "CodeFusion Dev" } };
  h.devices.mockResolvedValue([other, onlineDevice]);
  await h.entry.start();
  expect(h.onView.mock.lastCall[0].devices).toEqual([
    {
      deviceMid: onlineDevice.device_mid,
      name: "Alice’s MacBook",
      onlineConnections: [onlineDevice, other],
    },
  ]);
  expect(h.connect).not.toHaveBeenCalled();
  h.devices.mockResolvedValue([onlineDevice, other]);
  await h.entry.refreshDevices();
  expect(h.onView.mock.lastCall[0].devices[0].onlineConnections).toEqual([onlineDevice, other]);
  h.devices.mockResolvedValue([{ ...onlineDevice, online: false, meta: {} }, other]);
  await h.entry.refreshDevices();
  h.entry.selectDevice("last-device");
  expect(h.connect).not.toHaveBeenCalled();
  h.entry.selectDevice("other");
  expect(Object.fromEntries(new URL(h.href).searchParams)).toEqual({
    app_version: "3.13.0",
    sid: "other",
    mid: onlineDevice.device_mid,
    name: "CodeFusion Dev",
  });
  expect(h.storage.get("cf-web-remote-last-device-sid")).toBe("other");
  expect(h.storage.get("cf-web-remote-last-device-mid")).toBe(onlineDevice.device_mid);
});

it("Recent SID Online时优先Connect原 SID，即使同 MID 还有OtherOnlineConnect", async () => {
  const h = setup("jwt", "https://cf.z.ai/remote/v4");
  const preferred = { ...onlineDevice, device_sid: "preferred", meta: { name: "CodeFusion Dev" } };
  h.storage.set("cf-web-remote-last-device-sid", "preferred");
  h.devices.mockResolvedValue([onlineDevice, preferred]);
  await h.entry.start();
  expect(h.connect).toHaveBeenCalledOnce();
  expect(h.connect.mock.lastCall[0].params.deviceSid).toBe("preferred");
});

it("Recent SID Offline时，同One台电脑恰OKOne个OnlineConnect则Auto接上；MID 取自listMedium的Offline记录", async () => {
  const h = setup("jwt", "https://cf.z.ai/remote/v4");
  const preferred = { ...onlineDevice, device_sid: "preferred", online: false, meta: {} };
  h.storage.set("cf-web-remote-last-device-sid", "preferred");
  h.devices.mockResolvedValue([onlineDevice, preferred]);
  await h.entry.start();
  expect(h.connect).toHaveBeenCalledOnce();
  expect(h.connect.mock.lastCall[0].params).toMatchObject({
    deviceSid: "last-device",
    deviceMid: onlineDevice.device_mid,
  });
  expect(h.storage.get("cf-web-remote-last-device-sid")).toBe("last-device");
  expect(h.storage.get("cf-web-remote-last-device-mid")).toBe(onlineDevice.device_mid);
});

it("Recent SID 已被Delete时按记住的Recent MID 接上唯OneOnlineConnect", async () => {
  const h = setup("jwt", "https://cf.z.ai/remote/v4");
  h.storage.set("cf-web-remote-last-device-sid", "deleted-sid");
  h.storage.set("cf-web-remote-last-device-mid", onlineDevice.device_mid);
  const otherMachine = { ...onlineDevice, device_mid: "mid-other", device_sid: "other-sid" };
  h.devices.mockResolvedValue([otherMachine, onlineDevice]);
  await h.entry.start();
  expect(h.connect).toHaveBeenCalledOnce();
  expect(h.connect.mock.lastCall[0].params.deviceSid).toBe("last-device");
});

it.each([
  ["同 MID 有多个OnlineConnect", [onlineDevice, { ...onlineDevice, device_sid: "second" }]],
  ["同 MID 全Offline", [{ ...onlineDevice, online: false, meta: {} }]],
  ["只有Other电脑Online", [{ ...onlineDevice, device_mid: "mid-other", device_sid: "other-sid" }]],
])("Recent SID 不Online且%s时展示list，不猜测ConnectTarget", async (_case, records) => {
  const h = setup("jwt", "https://cf.z.ai/remote/v4");
  h.storage.set("cf-web-remote-last-device-sid", "deleted-sid");
  h.storage.set("cf-web-remote-last-device-mid", onlineDevice.device_mid);
  h.devices.mockResolvedValue(records);
  await h.entry.start();
  expect(h.connect).not.toHaveBeenCalled();
  expect(h.onView.mock.lastCall[0].kind).toBe("devices");
});

it("listView携带Current账Number展示资料，Refresh后保持", async () => {
  const account = { displayName: "Ada", provider: "zai" as const };
  const h = setup("jwt", "https://cf.z.ai/remote/v4", account);
  h.devices.mockResolvedValue([{ ...onlineDevice, meta: { name: "Mac", platform: "darwin" } }]);
  await h.entry.start();
  expect(h.onView.mock.lastCall[0]).toMatchObject({
    account,
    devices: [{ deviceMid: onlineDevice.device_mid, platform: "darwin" }],
  });
  await h.entry.refreshDevices();
  expect(h.onView.mock.lastCall[0].account).toEqual(account);
});

it("无码入口AutoConnectCurrent账NumberOnline的RecentDevice，并回写可恢复 URL", async () => {
  const h = setup("jwt", "https://cf.z.ai/remote/v4?app_version=3.13.0&name=stale");
  h.storage.set("cf-web-remote-last-device-sid", "last-device");
  h.devices.mockResolvedValue([onlineDevice]);
  await h.entry.start();
  expect(h.connect).toHaveBeenCalledOnce();
  expect(h.connect.mock.calls[0][0].params).toEqual({
    deviceSid: "last-device",
    deviceMid: "abcdefgh-1234",
    deviceName: "Alice’s MacBook",
    appVersion: "3.13.0",
  });
  const url = new URL(h.href);
  expect(Object.fromEntries(url.searchParams)).toEqual({
    sid: "last-device",
    mid: "abcdefgh-1234",
    name: "Alice’s MacBook",
    app_version: "3.13.0",
  });
});

it("RecentDeviceOffline时Online置顶按名CharacterSort；手动/回前台Refresh不AutoConnect，选择后只接纳One次", async () => {
  const h = setup("jwt", "https://cf.z.ai/remote/v4?app_version=3.13.0&name=stale");
  h.storage.set("cf-web-remote-last-device-sid", "last-device");
  const offline = { ...onlineDevice, online: false, meta: {} };
  const beta = {
    ...onlineDevice,
    device_mid: "mid-beta",
    device_sid: "beta",
    meta: { name: "Beta" },
  };
  const alpha = {
    ...onlineDevice,
    device_mid: "mid-alpha",
    device_sid: "alpha",
    meta: { name: "Alpha" },
  };
  const unnamed = { ...onlineDevice, device_mid: "mid-unnamed", device_sid: "unnamed", meta: {} };
  h.devices.mockResolvedValue([offline, beta, unnamed, alpha]);
  await h.entry.start();
  expect(h.onView).toHaveBeenLastCalledWith({
    kind: "devices",
    devices: [
      singleOnlineGroup(alpha),
      singleOnlineGroup(beta),
      singleOnlineGroup(unnamed),
      { deviceMid: offline.device_mid, name: undefined, onlineConnections: [] },
    ],
    loading: false,
    error: false,
  });
  h.entry.selectDevice("last-device");
  expect(h.connect).not.toHaveBeenCalled();
  h.devices.mockResolvedValue([onlineDevice, unnamed]);
  await h.entry.refreshDevices();
  h.show();
  await vi.waitFor(() => expect(h.devices).toHaveBeenCalledTimes(3));
  expect(h.connect).not.toHaveBeenCalled();
  await vi.waitFor(() =>
    expect(h.onView).toHaveBeenLastCalledWith({
      kind: "devices",
      devices: [singleOnlineGroup(onlineDevice), singleOnlineGroup(unnamed)],
      loading: false,
      error: false,
    }),
  );
  h.entry.selectDevice("unnamed");
  h.entry.selectDevice("unnamed");
  expect(h.connect).toHaveBeenCalledOnce();
  expect(Object.fromEntries(new URL(h.href).searchParams)).toEqual({
    app_version: "3.13.0",
    sid: "unnamed",
    mid: "mid-unnamed",
  });
  expect(h.storage.get("cf-web-remote-last-device-sid")).toBe("unnamed");
  h.show();
  expect(h.devices).toHaveBeenCalledTimes(3);
});

it("切换账NumberCancelConcurrencyRefresh，迟到Old账Numberlist不能覆盖登录页", async () => {
  const h = setup("jwt", "https://cf.z.ai/remote/v4");
  const pending = Promise.withResolvers<WebRemoteControlRelayV2Device[]>();
  h.devices.mockReturnValue(pending.promise);
  const started = h.entry.start();
  h.show();
  void h.entry.refreshDevices();
  expect(h.devices).toHaveBeenCalledOnce();
  const signal = h.devices.mock.calls[0][1];
  await h.entry.switchAccount();
  expect(signal.aborted).toBe(true);
  pending.resolve([onlineDevice]);
  await started;
  expect(h.onView).toHaveBeenLastCalledWith({ kind: "login" });
  expect(h.connect).not.toHaveBeenCalled();
  h.show();
  expect(h.devices).toHaveBeenCalledOnce();
});

it("listRefreshFailedShowError且禁用Oldlist，401 则回登录并Retain URL", async () => {
  const h = setup("jwt", "https://cf.z.ai/remote/v4?app_version=3.13.0");
  h.devices.mockResolvedValue([onlineDevice]);
  await h.entry.start();
  h.devices.mockRejectedValueOnce(new Error("network"));
  await h.entry.refreshDevices();
  expect(h.onView).toHaveBeenLastCalledWith({
    kind: "devices",
    devices: [singleOnlineGroup(onlineDevice)],
    loading: false,
    error: true,
  });
  h.entry.selectDevice("last-device");
  expect(h.connect).not.toHaveBeenCalled();
  h.devices.mockRejectedValueOnce(new WebRemoteControlV2ConnectionError("auth-required"));
  await h.entry.refreshDevices();
  expect(h.onView).toHaveBeenLastCalledWith({ kind: "login" });
  expect(h.auth.logout).toHaveBeenCalledOnce();
  h.entry.startLogin();
  expect(h.auth.startLogin).toHaveBeenCalledWith({ appReturnTo: h.href });
});

it("选择OtherDevice释放Connect、移除Target参Count并SkipRecentDevice；OldConnectEvents无效", async () => {
  const h = setup("jwt");
  await h.entry.start();
  const old = h.connect.mock.calls[0][0];
  old.onPaired();
  expect(h.storage.get("cf-web-remote-last-device-sid")).toBe("device-1");
  expect(h.storage.get("cf-web-remote-last-device-mid")).toBe("mid-1");
  h.devices.mockResolvedValue([{ ...onlineDevice, device_sid: "device-1" }]);
  await h.entry.chooseOtherDevice();
  expect(old.signal.aborted).toBe(true);
  expect(Object.fromEntries(new URL(h.href).searchParams)).toEqual({ app_version: "3.13.0" });
  expect(h.connect).toHaveBeenCalledOnce();
  old.onFailure({ reason: "auth-required" });
  old.onPaired();
  expect(h.auth.logout).not.toHaveBeenCalled();
  expect(h.onView.mock.lastCall[0].kind).toBe("devices");
});

it("账Number在listShow后变化时，OldDevice选择重New经过Current账Numberlist", async () => {
  const h = setup("alice", "https://cf.z.ai/remote/v4");
  h.devices.mockResolvedValue([onlineDevice]);
  await h.entry.start();
  h.setJwt("bob");
  h.devices.mockResolvedValue([]);
  h.entry.selectDevice("last-device");
  await vi.waitFor(() =>
    expect(h.devices).toHaveBeenLastCalledWith("bob", expect.any(AbortSignal)),
  );
  expect(h.connect).not.toHaveBeenCalled();
  expect(new URL(h.href).searchParams.has("sid")).toBe(false);
});

it("StorageUnavailable不阻断手动选择；已有 SID 业务Status保持原样", async () => {
  const h = setup("jwt", "https://cf.z.ai/remote/v4");
  h.storage.set("cf-web-remote-client-id:last-device", "existing-client");
  vi.spyOn(h.storageAdapter, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(h.storageAdapter, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  h.devices.mockResolvedValue([onlineDevice]);
  await h.entry.start();
  expect(h.onView.mock.lastCall[0].devices).toEqual([singleOnlineGroup(onlineDevice)]);
  h.entry.selectDevice("last-device");
  expect(h.connect).toHaveBeenCalledOnce();
  h.connect.mock.calls[0][0].onPaired();
  expect(h.storage.get("cf-web-remote-client-id:last-device")).toBe("existing-client");
});

it("Recent SID 不属于Current账Number时不Connect；同名按 MID/SID Sort且没有轮询", async () => {
  vi.useFakeTimers();
  try {
    const h = setup("jwt", "https://cf.z.ai/remote/v4");
    h.storage.set("cf-web-remote-last-device-sid", "other-account-device");
    const b = { ...onlineDevice, device_mid: "mid-b" };
    const a2 = { ...onlineDevice, device_mid: "mid-a", device_sid: "sid-2" };
    const a1 = { ...a2, device_sid: "sid-1" };
    h.devices.mockResolvedValue([b, a2, a1]);
    await h.entry.start();
    expect(h.onView.mock.lastCall[0].devices).toEqual([
      { deviceMid: "mid-a", name: "Alice’s MacBook", onlineConnections: [a1, a2] },
      singleOnlineGroup(b),
    ]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.devices).toHaveBeenCalledOnce();
    expect(h.connect).not.toHaveBeenCalled();
    h.entry.dispose();
    h.show();
    expect(h.devices).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});

it("聚合listRefresh期间Deny所有 SID，Refresh成全Offline后Retain记住的名Character但不RetainConnect", async () => {
  const h = setup("jwt", "https://cf.z.ai/remote/v4");
  const other = { ...onlineDevice, device_sid: "other" };
  h.devices.mockResolvedValue([onlineDevice, other]);
  await h.entry.start();
  const pending = Promise.withResolvers<WebRemoteControlRelayV2Device[]>();
  h.devices.mockReturnValueOnce(pending.promise);
  const refreshed = h.entry.refreshDevices();
  h.entry.selectDevice("last-device");
  h.entry.selectDevice("other");
  expect(h.connect).not.toHaveBeenCalled();
  pending.resolve([onlineDevice, other].map((device) => ({ ...device, online: false, meta: {} })));
  await refreshed;
  expect(h.onView.mock.lastCall[0].devices).toEqual([
    { deviceMid: onlineDevice.device_mid, name: "Alice’s MacBook", onlineConnections: [] },
  ]);
  h.entry.selectDevice("other");
  expect(h.connect).not.toHaveBeenCalled();
});

const DEVICE_NAMES_KEY = "cf-web-remote-device-names";

describe("Local记住的Device名与平台", () => {
  it("Online平台WriteCache，下次该DeviceOffline时仍Show记住的平台", async () => {
    const h = setup("jwt", "https://cf.z.ai/remote/v4");
    h.devices.mockResolvedValue([
      { ...onlineDevice, meta: { name: "Alice’s MacBook", platform: "darwin" } },
    ]);
    await h.entry.start();
    expect(JSON.parse(h.storage.get(DEVICE_NAMES_KEY)!)).toEqual([
      ["abcdefgh-1234", "Alice’s MacBook", "darwin"],
    ]);
    const next = setup("jwt", "https://cf.z.ai/remote/v4");
    next.storage.set(DEVICE_NAMES_KEY, h.storage.get(DEVICE_NAMES_KEY)!);
    next.devices.mockResolvedValue([{ ...onlineDevice, online: false, meta: {} }]);
    await next.entry.start();
    expect(next.onView.mock.lastCall[0].devices).toEqual([
      {
        deviceMid: "abcdefgh-1234",
        name: "Alice’s MacBook",
        platform: "darwin",
        onlineConnections: [],
      },
    ]);
  });

  it("OnlineDevice名按 MID WriteLocalCache；下次入口该DeviceOffline时Show记住的名Character且仍不可Connect", async () => {
    const h = setup("jwt", "https://cf.z.ai/remote/v4");
    h.devices.mockResolvedValue([onlineDevice]);
    await h.entry.start();
    expect(JSON.parse(h.storage.get(DEVICE_NAMES_KEY)!)).toEqual([
      ["abcdefgh-1234", "Alice’s MacBook"],
    ]);
    const next = setup("jwt", "https://cf.z.ai/remote/v4");
    next.storage.set(DEVICE_NAMES_KEY, h.storage.get(DEVICE_NAMES_KEY)!);
    next.devices.mockResolvedValue([
      { ...onlineDevice, device_sid: "history", online: false, meta: {} },
    ]);
    await next.entry.start();
    expect(next.onView).toHaveBeenLastCalledWith({
      kind: "devices",
      devices: [{ deviceMid: "abcdefgh-1234", name: "Alice’s MacBook", onlineConnections: [] }],
      loading: false,
      error: false,
    });
    next.entry.selectDevice("history");
    expect(next.connect).not.toHaveBeenCalled();
  });

  it("Online记录无名Character时回退到记住的名Character；电脑Rename后上线Refresh覆盖Old名Character", async () => {
    const h = setup("jwt", "https://cf.z.ai/remote/v4");
    h.storage.set(DEVICE_NAMES_KEY, JSON.stringify([["abcdefgh-1234", "Old Name"]]));
    h.devices.mockResolvedValue([{ ...onlineDevice, meta: {} }]);
    await h.entry.start();
    expect(h.onView.mock.lastCall[0].devices[0].name).toBe("Old Name");
    h.devices.mockResolvedValue([{ ...onlineDevice, meta: { name: "  New Name  " } }]);
    await h.entry.refreshDevices();
    expect(h.onView.mock.lastCall[0].devices[0].name).toBe("New Name");
    expect(JSON.parse(h.storage.get(DEVICE_NAMES_KEY)!)).toEqual([["abcdefgh-1234", "New Name"]]);
  });

  it("OfflineDevice按记住的名CharacterSort，没有名Character的OfflineDevice排最后；全OfflineRefresh不写Cache", async () => {
    const h = setup("jwt", "https://cf.z.ai/remote/v4");
    const seeded = JSON.stringify([
      ["mid-b", "Beta"],
      ["mid-a", "Alpha"],
    ]);
    h.storage.set(DEVICE_NAMES_KEY, seeded);
    const offline = (mid: string) => ({
      ...onlineDevice,
      device_mid: mid,
      device_sid: `${mid}-sid`,
      online: false,
      meta: {},
    });
    h.devices.mockResolvedValue([offline("mid-c"), offline("mid-b"), offline("mid-a")]);
    await h.entry.start();
    expect(h.onView.mock.lastCall[0].devices).toEqual([
      { deviceMid: "mid-a", name: "Alpha", onlineConnections: [] },
      { deviceMid: "mid-b", name: "Beta", onlineConnections: [] },
      { deviceMid: "mid-c", name: undefined, onlineConnections: [] },
    ]);
    expect(h.storage.get(DEVICE_NAMES_KEY)).toBe(seeded);
  });

  it("CacheCorrupted content按空Processing，不阻断list；Refresh成功后重写为合法inner容", async () => {
    const h = setup("jwt", "https://cf.z.ai/remote/v4");
    h.storage.set(DEVICE_NAMES_KEY, "{not json");
    h.devices.mockResolvedValue([
      onlineDevice,
      { ...onlineDevice, device_mid: "mid-x", device_sid: "sid-x", online: false, meta: {} },
    ]);
    await h.entry.start();
    expect(h.onView.mock.lastCall[0].devices).toEqual([
      singleOnlineGroup(onlineDevice),
      { deviceMid: "mid-x", name: undefined, onlineConnections: [] },
    ]);
    expect(JSON.parse(h.storage.get(DEVICE_NAMES_KEY)!)).toEqual([
      ["abcdefgh-1234", "Alice’s MacBook"],
    ]);
  });

  it("切换账Number不清除Device名Cache", async () => {
    const h = setup("jwt", "https://cf.z.ai/remote/v4");
    h.devices.mockResolvedValue([onlineDevice]);
    await h.entry.start();
    await h.entry.switchAccount();
    expect(h.onView).toHaveBeenLastCalledWith({ kind: "login" });
    expect(JSON.parse(h.storage.get(DEVICE_NAMES_KEY)!)).toEqual([
      ["abcdefgh-1234", "Alice’s MacBook"],
    ]);
  });
});
