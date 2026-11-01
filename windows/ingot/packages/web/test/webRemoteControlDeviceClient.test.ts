import { describe, expect, it } from "vitest";
import { createFakeRelayV2 } from "@origin-ai/cf-shared/testing/fake-relay-v2";
import { createWebRemoteControlDeviceClient } from "#src/web-remote-control/index.js";

describe("Devicelist HTTP", () => {
  it("Ignore响应Letter封、Device及 meta 的New增Character段后BackDevicelist", async () => {
    const devices = [
      {
        device_sid: "d_1",
        device_mid: "machine-1",
        created_at: 1_600_000_000,
        online: false,
        meta: {},
      },
    ];
    const list = createWebRemoteControlDeviceClient("https://relay.example", async () =>
      Response.json({
        code: 0,
        msg: "",
        data: devices.map((device) => ({
          ...device,
          capabilities: ["remote"],
          meta: { arch: "arm64" },
        })),
        logid: "request-1",
        server_version: "next",
      }),
    );
    await expect(list("jwt", new AbortController().signal)).resolves.toEqual(devices);
  });

  it("只BackCurrent JWT 账Number的Device；Other账NumberRecent SID 不能作为Connect依据", async () => {
    const relay = await createFakeRelayV2({ users: { a: "alice", b: "bob" } });
    try {
      for (const jwt of ["a", "b"]) {
        await fetch(`${relay.httpUrl}/api/v1/remote/device`, {
          method: "POST",
          headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
          body: JSON.stringify({ device_mid: `mid-${jwt}` }),
        });
      }
      const list = createWebRemoteControlDeviceClient(relay.httpUrl);
      const devices = await list("a", new AbortController().signal);
      expect(devices).toEqual([
        expect.objectContaining({ device_mid: "mid-a", online: false, meta: {} }),
      ]);
      expect(await list("b", new AbortController().signal)).toEqual([
        expect.objectContaining({ device_mid: "mid-b" }),
      ]);
      await expect(list("invalid", new AbortController().signal)).rejects.toMatchObject({
        reason: "auth-required",
      });
    } finally {
      await relay.close();
    }
  });
  it.each([
    [503, "unavailable"],
    [200, "not-json"],
    [200, JSON.stringify({ code: 1006, msg: "private server detail" })],
    [200, JSON.stringify({ code: 0, msg: "", data: [{ device_sid: "incomplete" }] })],
  ])("HTTP %s or非法Letter封不当成空Devicelist", async (status, body) => {
    const list = createWebRemoteControlDeviceClient(
      "https://relay.example",
      async () => new Response(body, { status }),
    );
    await expect(list("jwt", new AbortController().signal)).rejects.toMatchObject({
      reason: "relay-unavailable",
      message: "relay-unavailable",
    });
  });
});
