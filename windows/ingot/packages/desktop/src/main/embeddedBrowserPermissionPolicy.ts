import type { Session, Streams } from "electron";
import type { EmbeddedBrowserPermissionDeviceOption } from "@origin-ai/cf-shared";
import { readDeviceOptions } from "./embeddedBrowserDeviceOptions.js";
import {
  getEmbeddedBrowserSitePermission,
  initEmbeddedBrowserSitePermissions,
  writeEmbeddedBrowserSitePermission,
} from "./embeddedBrowserSitePermissions.js";

export const EMBEDDED_BROWSER_SILENT_ALLOW_PERMISSIONS: ReadonlySet<string> = new Set([
  "clipboard-sanitized-write",
  "fullscreen",
  "pointerLock",
  "mediaKeySystem",
]);

const PROMPT_PERMISSIONS: ReadonlySet<string> = new Set([
  "media",
  "clipboard-read",
  "geolocation",
  "notifications",
  "midi",
  "midiSysex",
  "idle-detection",
  "speaker-selection",
  "window-management",
  "storage-access",
  "top-level-storage-access",
  "keyboardLock",
  "fileSystem",
]);

const DEVICE_CHECK_PERMISSIONS: ReadonlySet<string> = new Set(["usb", "hid", "serial"]);

export type EmbeddedBrowserPermissionPromptAction =
  | "allow-always"
  | "allow-session"
  | "block-always"
  | "dismiss";

export interface EmbeddedBrowserPermissionPromptRequest {
  origin: string;
  permission: string;
  mediaTypes?: readonly string[];
  
  hostWebContentsId?: number;
  
  guestWebContentsId?: number;
}

export interface EmbeddedBrowserSitePermissionRecord {
  [origin: string]: { [permission: string]: "allow" | "deny" };
}

export interface EmbeddedBrowserSitePermissionStore {
  load(): Promise<EmbeddedBrowserSitePermissionRecord>;
  persist(record: EmbeddedBrowserSitePermissionRecord): Promise<void>;
}

export interface EmbeddedBrowserPermissionLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

export type EmbeddedBrowserPermissionSession = Session;

export interface EmbeddedBrowserDevicePickerSession {
  result: Promise<{ deviceId: string } | null>;
  updateDevices(devices: EmbeddedBrowserPermissionDeviceOption[]): void;
}

export interface EmbeddedBrowserPermissionPolicyOptions {
  logger: EmbeddedBrowserPermissionLogger;
  
  prompt?: (
    request: EmbeddedBrowserPermissionPromptRequest,
  ) => Promise<EmbeddedBrowserPermissionPromptAction>;
  
  store?: EmbeddedBrowserSitePermissionStore;
  
  devicePicker?: (input: {
    origin: string;
    permission: string;
    devices: EmbeddedBrowserPermissionDeviceOption[];
    hostWebContentsId?: number;
    guestWebContentsId?: number;
  }) => EmbeddedBrowserDevicePickerSession;
  
  onDisplayMediaRequest?: (input: { origin: string }, callback: (result: unknown) => void) => void;
}

export const EMBEDDED_BROWSER_PERMISSION_LOG_TAG = "[embedded-browser-permission]";
const LOG_TAG = EMBEDDED_BROWSER_PERMISSION_LOG_TAG;
const UNKNOWN_ORIGIN = "unknown";

export function originFromUrl(url: string | undefined): string {
  try {
    return new URL(url ?? "").origin;
  } catch {
    return UNKNOWN_ORIGIN;
  }
}

export async function applyEmbeddedBrowserPermissionPolicy(
  targetSession: EmbeddedBrowserPermissionSession,
  options: EmbeddedBrowserPermissionPolicyOptions,
): Promise<void> {
  const { logger } = options;

  await initEmbeddedBrowserSitePermissions({
    ...(options.store ? { store: options.store } : {}),
    logger,
  });

  const sessionAllow = new Map<string, Set<string>>();
  const inflight = new Map<string, Promise<EmbeddedBrowserPermissionPromptAction>>();

  const logDecision = (
    decision: "granted" | "denied",
    meta: Record<string, unknown>,
    warn = false,
  ): void => {
    const message = `${LOG_TAG} decision=${decision}`;
    if (warn) logger.warn(message, meta);
    else logger.info(message, meta);
  };

  targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = (details as { requestingUrl?: string }).requestingUrl;
    const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes;
    const origin = originFromUrl(requestingUrl);
    const hostWebContentsId = webContents.hostWebContents?.id ?? webContents.id;
    const guestWebContentsId = webContents.id;

    if (EMBEDDED_BROWSER_SILENT_ALLOW_PERMISSIONS.has(permission)) {
      logDecision("granted", { permission, origin, source: "allowlist" });
      callback(true);
      return;
    }

    if (PROMPT_PERMISSIONS.has(permission)) {
      const persisted = getEmbeddedBrowserSitePermission(origin, permission);
      if (persisted === "allow" || persisted === "deny") {
        logDecision(persisted === "allow" ? "granted" : "denied", {
          permission,
          origin,
          source: "site-setting",
        });
        callback(persisted === "allow");
        return;
      }
      if (sessionAllow.get(origin)?.has(permission)) {
        logDecision("granted", { permission, origin, source: "session-allow" });
        callback(true);
        return;
      }
      if (!options.prompt) {
        logDecision("denied", { permission, origin, source: "default-deny" });
        callback(false);
        return;
      }
      const key = `${origin}|${permission}`;
      let flight = inflight.get(key);
      if (!flight) {
        flight = options
          .prompt({
            origin,
            permission,
            hostWebContentsId,
            guestWebContentsId,
            ...(mediaTypes ? { mediaTypes } : {}),
          })
          .finally(() => {
            inflight.delete(key);
          });
        inflight.set(key, flight);
      }
      void flight.then(
        (action) => {
          const granted = action === "allow-always" || action === "allow-session";
          logDecision(granted ? "granted" : "denied", {
            permission,
            origin,
            source: "user-prompt",
            action,
          });
          if (action === "allow-always") {
            void writeEmbeddedBrowserSitePermission(origin, permission, "allow");
          } else if (action === "allow-session") {
            const grantedSet = sessionAllow.get(origin) ?? new Set<string>();
            grantedSet.add(permission);
            sessionAllow.set(origin, grantedSet);
          } else if (action === "block-always") {
            void writeEmbeddedBrowserSitePermission(origin, permission, "deny");
          }
          callback(granted);
        },
        (error: unknown) => {
          logger.warn(`${LOG_TAG} permission prompt failed: ${String(error)}`);
          callback(false);
        },
      );
      return;
    }

    logDecision("denied", { permission, origin, source: "default-deny" }, true);
    callback(false);
  });

  targetSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    if (EMBEDDED_BROWSER_SILENT_ALLOW_PERMISSIONS.has(permission)) return true;
    if (DEVICE_CHECK_PERMISSIONS.has(permission)) return true;
    if (!PROMPT_PERMISSIONS.has(permission)) return false;
    const origin = originFromUrl(requestingOrigin);
    if (getEmbeddedBrowserSitePermission(origin, permission) === "allow") return true;
    return sessionAllow.get(origin)?.has(permission) === true;
  });

  targetSession.setDevicePermissionHandler(() => true);

  targetSession.setDisplayMediaRequestHandler((request, callback) => {
    const frameUrl = (request as { frame?: { url?: string } }).frame?.url;
    const origin = originFromUrl(frameUrl);
    if (options.onDisplayMediaRequest) {
      logDecision("granted", { permission: "display-capture", origin, source: "source-picker" });
      options.onDisplayMediaRequest({ origin }, (result) => callback(result as Streams));
      return;
    }
    logDecision("denied", { permission: "display-capture", origin, source: "default-deny" });
    callback({});
  });

  const cancelArgFor = (permission: string): string | undefined =>
    permission === "select-hid-device" || permission === "select-usb-device" ? undefined : "";

  const devicePickerSessions = new Map<string, EmbeddedBrowserDevicePickerSession>();

  const settleDeviceSelection = (
    permission: string,
    input: {
      origin: string;
      devices: EmbeddedBrowserPermissionDeviceOption[];
      hostWebContentsId?: number;
      guestWebContentsId?: number;
    },
    callback: (value?: string) => void,
  ): void => {
    const cancel = cancelArgFor(permission);
    if (!options.devicePicker) {
      logDecision("denied", { permission, origin: input.origin, source: "device-picker" });
      callback(cancel);
      return;
    }
    const existing = devicePickerSessions.get(permission);
    if (existing) {
      logger.info(`${LOG_TAG} device list updated`, {
        permission,
        origin: input.origin,
        deviceCount: input.devices.length,
      });
      existing.updateDevices(input.devices);
      return;
    }
    let session: EmbeddedBrowserDevicePickerSession;
    try {
      session = options.devicePicker({ ...input, permission });
    } catch (error) {
      logger.warn(`${LOG_TAG} device picker failed: ${String(error)}`);
      callback(cancel);
      return;
    }
    devicePickerSessions.set(permission, session);
    logger.info(`${LOG_TAG} device picker opened`, {
      permission,
      origin: input.origin,
      deviceCount: input.devices.length,
    });
    void session.result.then(
      (picked) => {
        devicePickerSessions.delete(permission);
        if (!picked) {
          logDecision("denied", { permission, origin: input.origin, source: "device-picker" });
          callback(cancel);
          return;
        }
        logDecision("granted", { permission, origin: input.origin, source: "device-picker" });
        callback(picked.deviceId);
      },
      (error: unknown) => {
        devicePickerSessions.delete(permission);
        logger.warn(`${LOG_TAG} device picker failed: ${String(error)}`);
        callback(cancel);
      },
    );
  };

  // hid/usb: (event, details { deviceList, frame }, callback)
  const handleFramedDeviceSelection = (permission: string) => {
    return (event: unknown, details: unknown, callback: (value?: string) => void) => {
      (event as { preventDefault?: () => void }).preventDefault?.();
      const frameUrl = (details as { frame?: { url?: string } | null })?.frame?.url;
      const deviceList = (details as { deviceList?: unknown })?.deviceList;
      settleDeviceSelection(
        permission,
        {
          origin: originFromUrl(frameUrl),
          devices: readDeviceOptions(deviceList),
        },
        callback,
      );
    };
  };
  targetSession.on("select-hid-device", handleFramedDeviceSelection("select-hid-device"));
  targetSession.on("select-usb-device", handleFramedDeviceSelection("select-usb-device"));

  targetSession.on(
    "select-serial-port",
    (
      event: unknown,
      portList: unknown,
      webContents: unknown,
      callback: (portId: string) => void,
    ) => {
      (event as { preventDefault?: () => void }).preventDefault?.();
      const contents = webContents as {
        hostWebContents?: { id?: number };
        id?: number;
        getURL?: () => string;
      } | null;
      const hostWebContentsId = contents?.hostWebContents?.id ?? contents?.id;
      settleDeviceSelection(
        "select-serial-port",
        {
          origin: originFromUrl(contents?.getURL?.()),
          devices: readDeviceOptions(portList),
          ...(hostWebContentsId !== undefined ? { hostWebContentsId } : {}),
        },
        (value) => callback(value ?? ""),
      );
    },
  );
}
