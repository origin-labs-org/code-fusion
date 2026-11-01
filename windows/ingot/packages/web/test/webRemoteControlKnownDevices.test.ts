import { describe, expect, it } from "vitest";
import type { WebRemoteControlDeviceGroup } from "#src/web-remote-control/index.js";

import {
  KNOWN_DEVICES_KEY,
  KNOWN_DEVICES_LIMIT,
  readKnownDevices,
  rememberKnownDevices,
} from "#src/web-remote-control/index.js";

function memoryStorage(initial?: string) {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(KNOWN_DEVICES_KEY, initial);
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

const onlineGroup = (
  deviceMid: string,
  name?: string,
  platform?: string,
): WebRemoteControlDeviceGroup => ({
  deviceMid,
  name,
  platform,
  onlineConnections: [
    {
      device_sid: `${deviceMid}-sid`,
      device_mid: deviceMid,
      online: true,
      created_at: 1,
      meta: {},
    },
  ],
});

describe("Local记住的Device名与平台", () => {
  it("CompatibleOld [mid, name] Two元组，接受 [mid, name, platform]，Ignore形状不对的条目并去掉首尾空白", () => {
    const storage = memoryStorage(
      JSON.stringify([
        ["mid-1", " One "],
        ["mid-2"],
        "junk",
        ["mid-3", "   "],
        [3, "x"],
        ["", "empty"],
        ["mid-4", "Four", " darwin "],
        ["mid-5", "", "linux"],
        ["mid-6", "Six", 7],
        ["mid-7", "Seven", "win32", "extra"],
      ]),
    );
    expect([...readKnownDevices(storage)]).toEqual([
      ["mid-1", { name: "One" }],
      ["mid-4", { name: "Four", platform: "darwin" }],
      ["mid-5", { platform: "linux" }],
    ]);
  });

  it("缺失、非Array JSON、损坏inner容orReadThrow error都按没有记住任何DeviceProcessing", () => {
    expect(readKnownDevices(memoryStorage()).size).toBe(0);
    expect(readKnownDevices(memoryStorage('{"mid-1":"One"}')).size).toBe(0);
    expect(readKnownDevices(memoryStorage("{not json")).size).toBe(0);
    expect(
      readKnownDevices({
        getItem() {
          throw new Error("blocked");
        },
        setItem() {},
      }).size,
    ).toBe(0);
  });

  it("只Write有OnlineConnect且有名Characteror平台的Device项，再次见到的Device移到RecentLocation", () => {
    const storage = memoryStorage(
      JSON.stringify([
        ["mid-a", "A"],
        ["mid-b", "B", "win32"],
      ]),
    );
    const known = readKnownDevices(storage);
    rememberKnownDevices(storage, known, [
      onlineGroup("mid-a", "A renamed", "darwin"),
      onlineGroup("mid-c", "C"),
      onlineGroup("mid-d"),
      onlineGroup("mid-p", undefined, "linux"),
      { deviceMid: "mid-e", name: "E (offline, from cache)", onlineConnections: [] },
    ]);
    expect(JSON.parse(storage.map.get(KNOWN_DEVICES_KEY)!)).toEqual([
      ["mid-b", "B", "win32"],
      ["mid-a", "A renamed", "darwin"],
      ["mid-c", "C"],
      ["mid-p", "", "linux"],
    ]);
  });

  it("没有任何可Write的Device项时不触碰Storage", () => {
    const storage = memoryStorage(JSON.stringify([["mid-a", "A"]]));
    const known = readKnownDevices(storage);
    let writes = 0;
    rememberKnownDevices({ ...storage, setItem: () => void writes++ }, known, [
      { deviceMid: "mid-a", name: "A", onlineConnections: [] },
      onlineGroup("mid-x"),
    ]);
    expect(writes).toBe(0);
  });

  it(`超过 ${KNOWN_DEVICES_LIMIT} 条时淘汰最久未更New的条目`, () => {
    const seeded = Array.from({ length: KNOWN_DEVICES_LIMIT }, (_, i) => [`mid-${i}`, `D${i}`]);
    const storage = memoryStorage(JSON.stringify(seeded));
    const known = readKnownDevices(storage);
    rememberKnownDevices(storage, known, [
      onlineGroup("mid-0", "D0"),
      onlineGroup("mid-new", "New"),
    ]);
    const stored = JSON.parse(storage.map.get(KNOWN_DEVICES_KEY)!) as [string, string][];
    expect(stored).toHaveLength(KNOWN_DEVICES_LIMIT);
    expect(stored[0]).toEqual(["mid-2", "D2"]);
    expect(stored.at(-2)).toEqual(["mid-0", "D0"]);
    expect(stored.at(-1)).toEqual(["mid-new", "New"]);
  });

  it("Write failed静默Ignore，inner存Medium的映射仍已更New", () => {
    const known = new Map();
    expect(() =>
      rememberKnownDevices(
        {
          getItem: () => null,
          setItem() {
            throw new Error("blocked");
          },
        },
        known,
        [onlineGroup("mid-a", "A", "darwin")],
      ),
    ).not.toThrow();
    expect([...known]).toEqual([["mid-a", { name: "A", platform: "darwin" }]]);
  });
});
