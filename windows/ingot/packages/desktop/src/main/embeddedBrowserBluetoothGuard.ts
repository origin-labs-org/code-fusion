import type { WebContents } from "electron";
import type { EmbeddedBrowserPermissionDeviceOption } from "@origin-ai/cf-shared";
import {
  EMBEDDED_BROWSER_PERMISSION_LOG_TAG as LOG_TAG,
  originFromUrl,
  type EmbeddedBrowserDevicePickerSession,
} from "./embeddedBrowserPermissionPolicy.js";
import { readDeviceOptions } from "./embeddedBrowserDeviceOptions.js";

export function installEmbeddedBrowserBluetoothDeviceGuard(
  guestWebContents: Pick<WebContents, "getURL" | "id" | "on">,
  log: (...args: unknown[]) => void = console.info,
  options: {
    devicePicker?: (input: {
      origin: string;
      permission: string;
      devices: EmbeddedBrowserPermissionDeviceOption[];
      hostWebContentsId?: number;
      guestWebContentsId?: number;
    }) => EmbeddedBrowserDevicePickerSession;
    hostWebContentsId?: number;
  } = {},
): void {
  let session: EmbeddedBrowserDevicePickerSession | null = null;
  guestWebContents.on(
    "select-bluetooth-device",
    (event: unknown, devices: unknown, callback: (deviceId: string) => void) => {
      (event as { preventDefault?: () => void }).preventDefault?.();
      if (!options.devicePicker) {
        log(`${LOG_TAG} decision=denied`, {
          permission: "select-bluetooth-device",
          source: "device-picker",
        });
        callback("");
        return;
      }
      const origin = originFromUrl(guestWebContents.getURL());
      const deviceOptions = readDeviceOptions(devices);
      if (session) {
        log(`${LOG_TAG} device list updated`, {
          permission: "select-bluetooth-device",
          origin,
          deviceCount: deviceOptions.length,
        });
        session.updateDevices(deviceOptions);
        return;
      }
      try {
        session = options.devicePicker({
          origin,
          permission: "select-bluetooth-device",
          devices: deviceOptions,
          ...(options.hostWebContentsId !== undefined
            ? { hostWebContentsId: options.hostWebContentsId }
            : {}),
          guestWebContentsId: guestWebContents.id,
        });
      } catch (error) {
        log(`${LOG_TAG} decision=denied`, {
          permission: "select-bluetooth-device",
          origin,
          source: "device-picker",
          error: String(error),
        });
        callback("");
        return;
      }
      log(`${LOG_TAG} device picker opened`, {
        permission: "select-bluetooth-device",
        origin,
        deviceCount: deviceOptions.length,
      });
      void session.result.then(
        (picked) => {
          session = null;
          log(`${LOG_TAG} decision=${picked ? "granted" : "denied"}`, {
            permission: "select-bluetooth-device",
            origin,
            source: "device-picker",
          });
          callback(picked?.deviceId ?? "");
        },
        (error: unknown) => {
          session = null;
          log(`${LOG_TAG} decision=denied`, {
            permission: "select-bluetooth-device",
            origin,
            source: "device-picker",
            error: String(error),
          });
          callback("");
        },
      );
    },
  );
}
