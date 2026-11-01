import type { WebRemoteControlRelayV2Device } from "@origin-ai/cf-shared/web-remote-relay";
import type { KnownDevice, WebRemoteControlDeviceGroup } from "#src/web-remote-control/contract.js";

export function groupWebRemoteControlDevices(
  records: WebRemoteControlRelayV2Device[],
  locale: string,
  knownDevices: ReadonlyMap<string, KnownDevice> = new Map(),
): WebRemoteControlDeviceGroup[] {
  const collator = new Intl.Collator(locale);
  const displayName = (record: WebRemoteControlRelayV2Device) =>
    record.meta.name?.trim() || knownDevices.get(record.device_mid)?.name || "";
  const displayPlatform = (record: WebRemoteControlRelayV2Device) =>
    record.meta.platform?.trim() || knownDevices.get(record.device_mid)?.platform || "";
  const sorted = records.toSorted((a, b) => {
    const aName = displayName(a);
    const bName = displayName(b);
    return (
      Number(b.online) - Number(a.online) ||
      Number(!aName) - Number(!bName) ||
      collator.compare(aName, bName) ||
      collator.compare(a.device_mid, b.device_mid) ||
      collator.compare(a.device_sid, b.device_sid)
    );
  });
  const groups = new Map<string, WebRemoteControlDeviceGroup>();
  for (const record of sorted) {
    let group = groups.get(record.device_mid);
    if (!group) {
      group = {
        deviceMid: record.device_mid,
        name: displayName(record) || undefined,
        onlineConnections: [],
      };
      groups.set(record.device_mid, group);
    }
    if (!group.platform) {
      const platform = displayPlatform(record);
      if (platform) group.platform = platform;
    }
    if (record.online) group.onlineConnections.push(record);
  }
  return [...groups.values()];
}
