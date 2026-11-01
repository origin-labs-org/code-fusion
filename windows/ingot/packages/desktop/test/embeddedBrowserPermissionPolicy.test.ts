import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyEmbeddedBrowserPermissionPolicy,
  type EmbeddedBrowserPermissionPromptRequest,
  type EmbeddedBrowserPermissionSession,
  type EmbeddedBrowserSitePermissionRecord,
  type EmbeddedBrowserSitePermissionStore,
} from "../src/main/embeddedBrowserPermissionPolicy.js";
import { resetEmbeddedBrowserSitePermissionsForTest } from "../src/main/embeddedBrowserSitePermissions.js";
import { installEmbeddedBrowserBluetoothDeviceGuard } from "../src/main/embeddedBrowserBluetoothGuard.js";

interface CapturedRequestHandlers {
  request:
    | ((
        webContents: { getURL(): string },
        permission: string,
        callback: (granted: boolean) => void,
        details: { requestingUrl?: string; mediaTypes?: string[] },
      ) => void)
    | null;
  check:
    | ((
        webContents: { getURL(): string } | null,
        permission: string,
        requestingOrigin: string,
      ) => boolean)
    | null;
  device: ((details: { origin?: string; device?: { deviceId?: string } }) => boolean) | null;
  displayMedia: ((request: unknown, callback: (result: unknown) => void) => void) | null;
}

interface FakeSessionHelpers {
  handlers: CapturedRequestHandlers;
  emit: (event: string, ...args: unknown[]) => void;
}

function createFakeSession(): EmbeddedBrowserPermissionSession & FakeSessionHelpers {
  const handlers: CapturedRequestHandlers = {
    request: null,
    check: null,
    device: null,
    displayMedia: null,
  };
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const fake = {
    handlers,
    setPermissionRequestHandler: (handler: unknown) => {
      handlers.request = handler as CapturedRequestHandlers["request"];
    },
    setPermissionCheckHandler: (handler: unknown) => {
      handlers.check = handler as CapturedRequestHandlers["check"];
    },
    setDevicePermissionHandler: (handler: unknown) => {
      handlers.device = handler as CapturedRequestHandlers["device"];
    },
    setDisplayMediaRequestHandler: (handler: unknown) => {
      handlers.displayMedia = handler as CapturedRequestHandlers["displayMedia"];
    },
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const bucket = listeners.get(event) ?? [];
      bucket.push(listener);
      listeners.set(event, bucket);
    }),
    emit: (event: string, ...args: unknown[]) => {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
  };
  return fake as EmbeddedBrowserPermissionSession & FakeSessionHelpers;
}

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  };
}

function createInMemoryStore(initial: EmbeddedBrowserSitePermissionRecord = {}) {
  const record: EmbeddedBrowserSitePermissionRecord = structuredClone(initial);
  const store: EmbeddedBrowserSitePermissionStore & {
    record: EmbeddedBrowserSitePermissionRecord;
  } = {
    record,
    load: async () => structuredClone(record),
    persist: async (next) => {
      Object.keys(record).forEach((key) => delete record[key]);
      Object.assign(record, structuredClone(next));
    },
  };
  return store;
}

function driveRequest(
  session: EmbeddedBrowserPermissionSession & FakeSessionHelpers,
  permission: string,
  details: { requestingUrl?: string; mediaTypes?: string[] } = {},
): Promise<boolean> {
  const handler = session.handlers.request;
  if (!handler) throw new Error("request handler not registered");
  return new Promise((resolve) => {
    handler(
      {
        getURL: () => details.requestingUrl ?? "https://example.com/page",
        id: 42,
        hostWebContents: { id: 3 },
      },
      permission,
      resolve,
      details,
    );
  });
}

const GUEST_URL = "https://example.com/page";
const GUEST_ORIGIN = "https://example.com";

let session: ReturnType<typeof createFakeSession>;
let logger: ReturnType<typeof createLogger>;

beforeEach(() => {
  session = createFakeSession();
  logger = createLogger();
  resetEmbeddedBrowserSitePermissionsForTest();
});

describe("Silent allowlist", () => {
  it.each(["clipboard-sanitized-write", "fullscreen", "pointerLock", "mediaKeySystem"])(
    "%s allowed and logs allowlist",
    async (permission) => {
      await applyEmbeddedBrowserPermissionPolicy(session, { logger });

      await expect(driveRequest(session, permission, { requestingUrl: GUEST_URL })).resolves.toBe(
        true,
      );
      expect(session.handlers.check!(null, permission, GUEST_ORIGIN)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("decision=granted"),
        expect.objectContaining({ permission, source: "allowlist" }),
      );
    },
  );
});

describe("Dialog-level sensitive permissions", () => {
  it.each(["allow-always", "allow-session"] as const)(
    "After %s, Electron permission queries with paths share origin with requests, without cross-site or cross-permission contamination",
    async (action) => {
      const store = createInMemoryStore();
      await applyEmbeddedBrowserPermissionPolicy(session, {
        logger,
        store,
        prompt: async () => action,
      });
      await expect(driveRequest(session, "media", { requestingUrl: GUEST_URL })).resolves.toBe(
        true,
      );
      for (const url of [GUEST_ORIGIN, `${GUEST_ORIGIN}/`, GUEST_URL]) {
        expect(session.handlers.check!(null, "media", url)).toBe(true);
        expect(session.handlers.check!(null, "geolocation", url)).toBe(false);
      }
      for (const url of ["https://other.example/", "http://example.com/", "", "invalid"]) {
        expect(session.handlers.check!(null, "media", url)).toBe(false);
      }
    },
  );

  it("Defaults to deny when no record exists and dialog is not connected (security closed loop)", async () => {
    await applyEmbeddedBrowserPermissionPolicy(session, { logger });

    await expect(driveRequest(session, "media", { requestingUrl: GUEST_URL })).resolves.toBe(false);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("decision=denied"),
      expect.objectContaining({ permission: "media", source: "default-deny" }),
    );
  });

  it("Silently allows on persistent record allow, silently denies without dialog on deny", async () => {
    const store = createInMemoryStore({
      [GUEST_ORIGIN]: { media: "allow", geolocation: "deny" },
    });
    const prompt = vi.fn();
    await applyEmbeddedBrowserPermissionPolicy(session, { logger, prompt, store });

    await expect(driveRequest(session, "media", { requestingUrl: GUEST_URL })).resolves.toBe(true);
    expect(prompt).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ permission: "media", source: "site-setting" }),
    );

    await expect(driveRequest(session, "geolocation", { requestingUrl: GUEST_URL })).resolves.toBe(
      false,
    );
    expect(prompt).not.toHaveBeenCalled();
  });

  it("check handler 与持久记录一致：allow → true，deny/无记录 → false", async () => {
    const store = createInMemoryStore({ [GUEST_ORIGIN]: { media: "allow" } });
    await applyEmbeddedBrowserPermissionPolicy(session, { logger, store });

    expect(session.handlers.check!(null, "media", GUEST_ORIGIN)).toBe(true);
    expect(session.handlers.check!(null, "geolocation", GUEST_ORIGIN)).toBe(false);
    expect(session.handlers.check!(null, "clipboard-read", GUEST_ORIGIN)).toBe(false);
  });

  it.each([
    ["allow-always", true, "site-setting"],
    ["allow-session", true, "session-allow"],
    ["block-always", false, "site-setting"],
  ] as const)(
    "Dialog action %s → granted=%s; second request hits %s and no longer prompts",
    async (action, granted, secondSource) => {
      const store = createInMemoryStore();
      const prompt = vi.fn(async () => action);
      await applyEmbeddedBrowserPermissionPolicy(session, { logger, prompt, store });

      await expect(
        driveRequest(session, "clipboard-read", { requestingUrl: GUEST_URL }),
      ).resolves.toBe(granted);
      expect(prompt).toHaveBeenCalledTimes(1);

      await expect(
        driveRequest(session, "clipboard-read", { requestingUrl: GUEST_URL }),
      ).resolves.toBe(granted);
      expect(prompt).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ permission: "clipboard-read", source: secondSource }),
      );

      if (action === "allow-always") {
        expect(store.record[GUEST_ORIGIN]?.["clipboard-read"]).toBe("allow");
      }
      if (action === "block-always") {
        expect(store.record[GUEST_ORIGIN]?.["clipboard-read"]).toBe("deny");
      }
    },
  );

  it("dismiss (✕/timeout) is not remembered: denied this time, prompted again next time", async () => {
    const store = createInMemoryStore();
    const prompt = vi.fn(async () => "dismiss" as const);
    await applyEmbeddedBrowserPermissionPolicy(session, { logger, prompt, store });

    await expect(
      driveRequest(session, "clipboard-read", { requestingUrl: GUEST_URL }),
    ).resolves.toBe(false);
    await expect(
      driveRequest(session, "clipboard-read", { requestingUrl: GUEST_URL }),
    ).resolves.toBe(false);
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(store.record[GUEST_ORIGIN]).toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ permission: "clipboard-read", source: "user-prompt" }),
    );
  });

  it("allow-session is isolated by origin: different sites prompt and remember separately", async () => {
    const prompt = vi.fn(async () => "allow-session" as const);
    await applyEmbeddedBrowserPermissionPolicy(session, { logger, prompt });

    await expect(driveRequest(session, "media", { requestingUrl: GUEST_URL })).resolves.toBe(true);
    await expect(
      driveRequest(session, "media", { requestingUrl: "https://other.com/page" }),
    ).resolves.toBe(true);
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(prompt.mock.calls[0][0].origin).toBe(GUEST_ORIGIN);
    expect(prompt.mock.calls[1][0].origin).toBe("https://other.com");
    await expect(driveRequest(session, "media", { requestingUrl: GUEST_URL })).resolves.toBe(true);
    await expect(
      driveRequest(session, "media", { requestingUrl: "https://other.com/page" }),
    ).resolves.toBe(true);
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it("Concurrent requests with same origin + permission show only one dialog", async () => {
    let resolvePrompt: (action: "allow-always") => void = () => undefined;
    const prompt = vi.fn(
      () =>
        new Promise<"allow-always">((resolve) => {
          resolvePrompt = resolve;
        }),
    );
    await applyEmbeddedBrowserPermissionPolicy(session, { logger, prompt });

    const first = driveRequest(session, "media", { requestingUrl: GUEST_URL });
    const second = driveRequest(session, "media", { requestingUrl: GUEST_URL });
    resolvePrompt("allow-always");
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("Dialog request carries mediaTypes, used by UI to indicate camera/microphone", async () => {
    const prompt = vi.fn(async () => "dismiss" as const);
    await applyEmbeddedBrowserPermissionPolicy(session, { logger, prompt });

    await driveRequest(session, "media", {
      requestingUrl: GUEST_URL,
      mediaTypes: ["video"],
    });
    const request: EmbeddedBrowserPermissionPromptRequest = prompt.mock.calls[0][0];
    expect(request.origin).toBe(GUEST_ORIGIN);
    expect(request.permission).toBe("media");
    expect(request.mediaTypes).toEqual(["video"]);
    expect(request.hostWebContentsId).toBe(3);
    expect(request.guestWebContentsId).toBe(42);
  });

  it("Rejects and logs warn when dialog promise fails", async () => {
    const prompt = vi.fn(async () => {
      throw new Error("renderer gone");
    });
    await applyEmbeddedBrowserPermissionPolicy(session, { logger, prompt });

    await expect(driveRequest(session, "media", { requestingUrl: GUEST_URL })).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe("fail-closed rejection", () => {
  it.each(["openExternal", "unknown", "deprecated-sync-clipboard-read", "brand-new-permission"])(
    "%s is rejected uniformly and logs warn",
    async (permission) => {
      await applyEmbeddedBrowserPermissionPolicy(session, { logger });

      await expect(driveRequest(session, permission, { requestingUrl: GUEST_URL })).resolves.toBe(
        false,
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("decision=denied"),
        expect.objectContaining({ permission, source: "default-deny" }),
      );
      expect(session.handlers.check!(null, permission, GUEST_ORIGIN)).toBe(false);
    },
  );
});

describe("Device and screen sharing", () => {
  it("setDevicePermissionHandler always true: allow through to select-* chooser (tested: false completely blocks requestDevice)", async () => {
    await applyEmbeddedBrowserPermissionPolicy(session, { logger });

    expect(session.handlers.device!({ origin: GUEST_ORIGIN, device: { deviceId: "dev-1" } })).toBe(
      true,
    );
    expect(session.handlers.device!({ origin: "unknown", device: undefined })).toBe(true);
  });

  it("check handler allows device permissions (usb/hid/serial) through to chooser (tested: false completely blocks requestDevice at check layer)", async () => {
    await applyEmbeddedBrowserPermissionPolicy(session, { logger });

    expect(session.handlers.check!(null, "usb", GUEST_ORIGIN)).toBe(true);
    expect(session.handlers.check!(null, "hid", GUEST_ORIGIN)).toBe(true);
    expect(session.handlers.check!(null, "serial", GUEST_ORIGIN)).toBe(true);
    expect(session.handlers.check!(null, "unknown", GUEST_ORIGIN)).toBe(false);
  });

  it.each([
    ["select-hid-device", undefined],
    ["select-usb-device", undefined],
    ["select-serial-port", ""],
  ])("%s cancels request before chooser is connected (prevents silent authorization of first device)", async (event, cancelArg) => {
    await applyEmbeddedBrowserPermissionPolicy(session, { logger });

    const callback = vi.fn();
    const webContentsStub = { getURL: () => GUEST_URL, id: 7, hostWebContents: { id: 3 } };
    if (event === "select-serial-port") {
      session.emit(
        event,
        { preventDefault: vi.fn() },
        [{ portId: "port-1", portName: "COM1" }],
        webContentsStub,
        callback,
      );
    } else {
      session.emit(
        event,
        { preventDefault: vi.fn() },
        { deviceList: [{ deviceId: "dev-1" }] },
        callback,
      );
    }
    expect(callback).toHaveBeenCalledWith(cancelArg);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("decision=denied"),
      expect.objectContaining({ permission: event, source: "device-picker" }),
    );
  });

  it("Callbacks deviceId after device selector selects", async () => {
    const devicePicker = vi.fn(() => ({
      result: Promise.resolve({ deviceId: "dev-9" }),
      updateDevices: vi.fn(),
    }));
    await applyEmbeddedBrowserPermissionPolicy(session, { logger, devicePicker });

    const callback = vi.fn();
    session.emit(
      "select-hid-device",
      { preventDefault: vi.fn() },
      { deviceList: [{ deviceId: "dev-9" }] },
      callback,
    );
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith("dev-9"));
    expect(devicePicker).toHaveBeenCalledWith(
      expect.objectContaining({ permission: "select-hid-device", origin: "unknown" }),
    );
  });

  it("Invokes callback with cancellation semantics when device selector is cancelled (null)", async () => {
    const devicePicker = vi.fn(() => ({
      result: Promise.resolve(null),
      updateDevices: vi.fn(),
    }));
    await applyEmbeddedBrowserPermissionPolicy(session, { logger, devicePicker });

    const callback = vi.fn();
    session.emit(
      "select-usb-device",
      { preventDefault: vi.fn() },
      { deviceList: [{ deviceId: "dev-1" }] },
      callback,
    );
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(undefined));
  });

  it("While chooser with same permission is open, subsequent select events only hot-update list without opening a new one", async () => {
    let resolvePicker: (value: { deviceId: string } | null) => void = () => undefined;
    const updateDevices = vi.fn();
    const devicePicker = vi.fn(() => ({
      result: new Promise<{ deviceId: string } | null>((resolve) => {
        resolvePicker = resolve;
      }),
      updateDevices,
    }));
    await applyEmbeddedBrowserPermissionPolicy(session, { logger, devicePicker });

    const firstCallback = vi.fn();
    session.emit("select-hid-device", {}, { deviceList: [{ deviceId: "dev-1" }] }, firstCallback);
    await vi.waitFor(() => expect(devicePicker).toHaveBeenCalledTimes(1));

    const secondCallback = vi.fn();
    session.emit(
      "select-hid-device",
      { preventDefault: vi.fn() },
      { deviceList: [{ deviceId: "dev-1" }, { deviceId: "dev-2" }] },
      secondCallback,
    );
    expect(devicePicker).toHaveBeenCalledTimes(1);
    expect(updateDevices).toHaveBeenCalledWith([{ deviceId: "dev-1" }, { deviceId: "dev-2" }]);
    expect(secondCallback).not.toHaveBeenCalled();

    resolvePicker({ deviceId: "dev-2" });
    await vi.waitFor(() => expect(firstCallback).toHaveBeenCalledWith("dev-2"));
    const thirdCallback = vi.fn();
    session.emit(
      "select-hid-device",
      { preventDefault: vi.fn() },
      { deviceList: [{ deviceId: "dev-3" }] },
      thirdCallback,
    );
    await vi.waitFor(() => expect(devicePicker).toHaveBeenCalledTimes(2));
  });

  it("displayMedia forwards to onDisplayMediaRequest and transparently passes callback results", async () => {
    const onDisplayMediaRequest = vi.fn(
      (_input: { origin: string }, callback: (result: unknown) => void) => {
        callback({ video: { id: "screen:1" } });
      },
    );
    await applyEmbeddedBrowserPermissionPolicy(session, { logger, onDisplayMediaRequest });

    const callback = vi.fn();
    session.handlers.displayMedia!({ frame: { url: GUEST_URL }, videoRequested: true }, callback);
    expect(onDisplayMediaRequest).toHaveBeenCalledWith(
      { origin: GUEST_ORIGIN },
      expect.any(Function),
    );
    expect(callback).toHaveBeenCalledWith({ video: { id: "screen:1" } });
  });

  it("select-bluetooth-device attached to guest WebContents: cancels request with empty string after guard installed", async () => {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const guestWebContents = {
      on: (event: string, listener: (...args: unknown[]) => void) => {
        const bucket = listeners.get(event) ?? [];
        bucket.push(listener);
        listeners.set(event, bucket);
      },
    };
    installEmbeddedBrowserBluetoothDeviceGuard(guestWebContents, logger.info);

    const callback = vi.fn();
    for (const listener of listeners.get("select-bluetooth-device") ?? []) {
      listener({}, [{ deviceId: "bt-1" }], callback);
    }
    expect(callback).toHaveBeenCalledWith("");
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("decision=denied"),
      expect.objectContaining({ permission: "select-bluetooth-device", source: "device-picker" }),
    );
  });

  it("setDisplayMediaRequestHandler rejects all requests before source selector is connected", async () => {
    await applyEmbeddedBrowserPermissionPolicy(session, { logger });

    const callback = vi.fn();
    session.handlers.displayMedia!({ frame: null, videoRequested: true }, callback);
    expect(callback).toHaveBeenCalledWith({});
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("decision=denied"),
      expect.objectContaining({ permission: "display-capture", source: "default-deny" }),
    );
  });
});

describe("持久化 store 集成", () => {
  it("Load persistent records on apply, sync to store on write", async () => {
    const store = createInMemoryStore({ "https://allowed.com": { notifications: "allow" } });
    const prompt = vi.fn(async () => "block-always" as const);
    await applyEmbeddedBrowserPermissionPolicy(session, { logger, prompt, store });

    expect(session.handlers.check!(null, "notifications", "https://allowed.com")).toBe(true);

    await expect(
      driveRequest(session, "notifications", { requestingUrl: "https://allowed.com/page" }),
    ).resolves.toBe(true);

    await expect(driveRequest(session, "midi", { requestingUrl: GUEST_URL })).resolves.toBe(false);
    expect(store.record[GUEST_ORIGIN]?.["midi"]).toBe("deny");
  });

  it("store persist failure does not affect in-memory decisions; only logs a warning", async () => {
    const store: EmbeddedBrowserSitePermissionStore = {
      load: async () => ({}),
      persist: async () => {
        throw new Error("disk full");
      },
    };
    const prompt = vi.fn(async () => "allow-always" as const);
    await applyEmbeddedBrowserPermissionPolicy(session, { logger, prompt, store });

    await expect(driveRequest(session, "midi", { requestingUrl: GUEST_URL })).resolves.toBe(true);
    expect(logger.warn).toHaveBeenCalled();
    await expect(driveRequest(session, "midi", { requestingUrl: GUEST_URL })).resolves.toBe(true);
    expect(prompt).toHaveBeenCalledTimes(1);
  });
});
