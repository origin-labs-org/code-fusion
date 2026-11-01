import { describe, expect, it } from "vitest";
import {
  isUtcPlusEightTimeZone,
  resolveRemoteCdnBaseUrls,
  shouldPreferDomesticRemoteCdn,
} from "../src/main/remoteCdn.js";

describe("remoteCdn", () => {
  it("Prefer domestic CDN when Chinese and in UTC+8", () => {
    expect(
      shouldPreferDomesticRemoteCdn({
        locale: "zh-CN",
        timeZone: "Asia/Shanghai",
      }),
    ).toBe(true);
    expect(
      resolveRemoteCdnBaseUrls({
        env: "production",
        locale: "zh-CN",
        timeZone: "Asia/Shanghai",
        version: "0.0.0-test",
      }),
    ).toEqual([
      "https://cdn.codegeex.cn/cf/electron/releases/0.0.0-test",
      "https://cdn-cf.z.ai/cf/electron/releases/0.0.0-test",
    ]);
  });

  it("Prefer overseas CDN when non-Chinese or not in UTC+8", () => {
    expect(
      shouldPreferDomesticRemoteCdn({
        locale: "en-US",
        timeZone: "Asia/Shanghai",
      }),
    ).toBe(false);
    expect(
      shouldPreferDomesticRemoteCdn({
        locale: "zh-CN",
        timeZone: "America/Los_Angeles",
      }),
    ).toBe(false);
    expect(
      resolveRemoteCdnBaseUrls({
        env: "production",
        locale: "zh-CN",
        timeZone: "America/Los_Angeles",
        version: "0.0.0-test",
      }),
    ).toEqual([
      "https://cdn-cf.z.ai/cf/electron/releases/0.0.0-test",
      "https://cdn.codegeex.cn/cf/electron/releases/0.0.0-test",
    ]);
  });

  it("UTC+8 judgment should be based on UTC offset rather than a fixed city list", () => {
    expect(isUtcPlusEightTimeZone("Asia/Shanghai")).toBe(true);
    expect(isUtcPlusEightTimeZone("Asia/Singapore")).toBe(true);
    expect(isUtcPlusEightTimeZone("Asia/Tokyo")).toBe(false);
  });

  it("Test product environments should consistently use the internal SSH remote assets root directory", () => {
    expect(
      resolveRemoteCdnBaseUrls({
        env: "test",
        locale: "zh-CN",
        timeZone: "Asia/Shanghai",
        version: "0.0.0-test",
      }),
    ).toEqual([
      "http://intranet.example.invalid:12345/ssh-remote-assets/0.0.0-test",
    ]);
  });

  it("Do not select default values by product environment when explicitly overriding the CDN base URL", () => {
    expect(
      resolveRemoteCdnBaseUrls({
        env: "test",
        overrideBaseUrl: "https://cdn.example.com/releases///",
        version: "0.0.0-test",
      }),
    ).toEqual(["https://cdn.example.com/releases"]);
  });
});
