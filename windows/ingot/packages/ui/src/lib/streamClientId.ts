
import { createUuid } from "@origin-ai/cf-shared";

let cachedStreamClientId: string | null = null;

export function getStreamClientId(): string {
  if (cachedStreamClientId) {
    return cachedStreamClientId;
  }
  cachedStreamClientId = `renderer:${createUuid()}`;
  return cachedStreamClientId;
}

export function setStreamClientId(deviceId: string): void {
  const normalizedDeviceId = deviceId.trim();
  if (!normalizedDeviceId) {
    cachedStreamClientId = cachedStreamClientId ?? `renderer:fallback-${createUuid()}`;
    return;
  }
  cachedStreamClientId = `renderer:${normalizedDeviceId}`;
}

export function generateMobileDeviceFingerprint(): string {
  const nav = globalThis.navigator as Navigator & { platform?: string };
  const platform = nav?.platform ?? "";
  const screenWidth = globalThis.screen?.width;
  const screenHeight = globalThis.screen?.height;
  const colorDepth = globalThis.screen?.colorDepth;
  const parts = [
    platform,
    screenWidth !== undefined ? String(screenWidth) : "",
    screenHeight !== undefined ? String(screenHeight) : "",
    colorDepth !== undefined ? String(colorDepth) : "",
  ];
  return parts.filter(Boolean).join("|");
}
