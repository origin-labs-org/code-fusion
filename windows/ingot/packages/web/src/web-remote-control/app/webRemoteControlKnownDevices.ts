import type { WebRemoteControlDeviceGroup, KnownDevice } from "#src/web-remote-control/contract.js";

export const KNOWN_DEVICES_KEY = "cf-web-remote-device-names";

export const KNOWN_DEVICES_LIMIT = 50;

type KnownDeviceStorage = Pick<Storage, "getItem" | "setItem">;

function toKnownDevice(name: string, platform: string | undefined): KnownDevice | null {
  const trimmedName = name.trim();
  const trimmedPlatform = platform?.trim();
  if (!trimmedName && !trimmedPlatform) return null;
  return {
    ...(trimmedName ? { name: trimmedName } : {}),
    ...(trimmedPlatform ? { platform: trimmedPlatform } : {}),
  };
}

export function readKnownDevices(storage: KnownDeviceStorage): Map<string, KnownDevice> {
  const devices = new Map<string, KnownDevice>();
  try {
    const raw = storage.getItem(KNOWN_DEVICES_KEY);
    if (!raw) return devices;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return devices;
    for (const item of parsed) {
      if (!Array.isArray(item) || (item.length !== 2 && item.length !== 3)) continue;
      const [mid, name, platform] = item as unknown[];
      if (typeof mid !== "string" || !mid || typeof name !== "string") continue;
      if (platform !== undefined && typeof platform !== "string") continue;
      const device = toKnownDevice(name, platform);
      if (device) devices.set(mid, device);
    }
  } catch {
    devices.clear();
  }
  return devices;
}

export function rememberKnownDevices(
  storage: KnownDeviceStorage,
  known: Map<string, KnownDevice>,
  groups: readonly WebRemoteControlDeviceGroup[],
): void {
  let touched = false;
  for (const group of groups) {
    if (group.onlineConnections.length === 0) continue;
    const device = toKnownDevice(group.name ?? "", group.platform);
    if (!device) continue;
    known.delete(group.deviceMid);
    known.set(group.deviceMid, device);
    touched = true;
  }
  if (!touched) return;
  while (known.size > KNOWN_DEVICES_LIMIT) {
    const oldest = known.keys().next().value;
    if (oldest === undefined) break;
    known.delete(oldest);
  }
  try {
    storage.setItem(
      KNOWN_DEVICES_KEY,
      JSON.stringify(
        [...known].map(([mid, device]) =>
          device.platform ? [mid, device.name ?? "", device.platform] : [mid, device.name ?? ""],
        ),
      ),
    );
  } catch {
  }
}
