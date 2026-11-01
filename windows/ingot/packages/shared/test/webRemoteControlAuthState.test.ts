import { describe, expect, it } from "vitest";
import { webRemoteControlAuthStateChangeSchema } from "@origin-ai/cf-shared";

describe("renderer remote control login notification contract", () => {
  it.each(["signed-in", "signed-out"])("Accept %s events", (state) => {
    expect(webRemoteControlAuthStateChangeSchema.parse({ state })).toEqual({ state });
  });
  it.each([
    null,
    {},
    [],
    { state: true },
    { state: "login" },
    { state: "signed-in", jwt: "secret" },
    { state: "signed-out", windowId: 2 },
  ])("拒绝非法类型与额外字段 %j", (payload) => {
    expect(webRemoteControlAuthStateChangeSchema.safeParse(payload).success).toBe(false);
  });
});
