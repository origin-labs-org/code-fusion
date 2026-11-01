import type { ArmsCustomEventPayload } from "@origin-ai/cf-shared";
import { shouldExposeE2EStoreBridge } from "@/lib/e2eStoreBridge.js";

export interface ArmsCustomEventE2EEntry extends ArmsCustomEventPayload {
  recordedAt: number;
}

const MAX_ARMS_CUSTOM_EVENT_ENTRIES = 200;

type ArmsCustomEventDebugWindow = Window & {
  __cfArmsCustomEventsE2E?: ArmsCustomEventE2EEntry[];
};

export function recordArmsCustomEventForE2E(
  payload: ArmsCustomEventPayload,
  options: {
    enabled?: boolean;
    host?: ArmsCustomEventDebugWindow;
    now?: () => number;
  } = {},
): void {
  const enabled = options.enabled ?? shouldExposeE2EStoreBridge();
  if (!enabled || (typeof window === "undefined" && !options.host)) return;

  const host = options.host ?? (window as ArmsCustomEventDebugWindow);
  const buffer = (host.__cfArmsCustomEventsE2E ??= []);
  buffer.push({
    ...payload,
    ...(payload.properties ? { properties: { ...payload.properties } } : {}),
    recordedAt: (options.now ?? Date.now)(),
  });
  if (buffer.length > MAX_ARMS_CUSTOM_EVENT_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_ARMS_CUSTOM_EVENT_ENTRIES);
  }
}
