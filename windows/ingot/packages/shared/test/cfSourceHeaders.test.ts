import { describe, expect, it } from "vitest";
import {
  buildCfSourceHeadersFromContext,
  CF_SOURCE_HEADERS,
} from "../src/cf-source-headers.js";

describe("buildCfSourceHeadersFromContext", () => {
  it("builds the shared CodeFusion endpoint attribution headers", () => {
    expect(
      buildCfSourceHeadersFromContext({
        appVersion: " 2.14.0 ",
        arch: "arm64",
        clientLanguage: "zh-CN",
        clientTimezone: "Asia/Shanghai",
        deviceMid: "mid-1",
        endpointOrigin: "https://cf.z.ai",
        osVersion: "Darwin 25.0.0",
        platform: "darwin",
        releaseChannel: "test",
        sourceTitle: "cli",
      }),
    ).toEqual({
      ...CF_SOURCE_HEADERS,
      "HTTP-Referer": "https://cf.z.ai",
      "User-Agent": "CodeFusion/2.14.0",
      "X-CodeFusion-App-Version": "2.14.0",
      "X-Title": "Z Code@cli",
      "X-Platform": "darwin-arm64",
      "X-Release-Channel": "test",
      "X-Client-Language": "zh-CN",
      "X-Client-Timezone": "Asia/Shanghai",
      "X-Os-Category": "macos",
      "X-Os-Version": "Darwin 25.0.0",
      "X-Device-Mid": "mid-1",
    });
  });

  it("drops invalid optional values without emitting malformed headers", () => {
    const headers = buildCfSourceHeadersFromContext({
      appVersion: "bad\nversion",
      clientLanguage: "\n",
      clientTimezone: "",
      deviceMid: "bad\nmid",
      platform: "win32",
      sourceTitle: "electron",
    });

    expect(headers).toMatchObject({
      "User-Agent": "CodeFusion/unknown",
      "X-Client-Language": "unknown",
      "X-Client-Timezone": "unknown",
      "X-Os-Category": "windows",
      "X-Title": "Z Code@electron",
    });
    expect(headers).not.toHaveProperty("X-Device-Mid");
    expect(headers).not.toHaveProperty("X-CodeFusion-App-Version");
  });
});
