import { describe, expect, it } from "vitest";
import {
  buildRewardsUrl,
  isTrustedRewardsUrl,
  resolveRewardsOrigin,
  REWARDS_PARTITION,
  REWARDS_CONTEXT_EVENT,
} from "@origin-ai/cf-shared";

describe("Rewards embedded contract", () => {
  it("Use new partitions and events directly; old homepage is no longer trusted", () => {
    expect(REWARDS_PARTITION).toBe("persist:cf-rewards");
    expect(REWARDS_CONTEXT_EVENT).toBe("cf-rewards-context");
    for (const lang of ["cn", "en"]) {
      expect(isTrustedRewardsUrl(`https://cf.z.ai/${lang}/referrals?embedded=app`)).toBe(false);
      expect(
        isTrustedRewardsUrl(`http://localhost:3000/${lang}/referrals?embedded=app`, { dev: true }),
      ).toBe(false);
    }
  });
  it("Parse three environments, cn/en, and themes", () => {
    expect(resolveRewardsOrigin({ env: "test", dev: true })).toBe("https://cf.z.ai");
    expect(resolveRewardsOrigin({ env: "production", dev: true })).toBe("https://cf.z.ai");
    expect(resolveRewardsOrigin({ env: "test" })).toBe("https://cf.z.ai");
    expect(resolveRewardsOrigin({ env: "production" })).toBe("https://cf.z.ai");
    expect(buildRewardsUrl("https://cf.z.ai", "zh-CN", "cf-light")).toBe(
      "https://cf.z.ai/cn/rewards?embedded=app&theme=cf-light",
    );
    expect(buildRewardsUrl("https://cf.z.ai", "en-US", "cf-dark")).toContain(
      "/en/rewards?",
    );
  });
  it("本地网页必须显式覆盖且仅开发模式允许", () => {
    for (const env of ["test", "production"] as const) {
      expect(resolveRewardsOrigin({ env, dev: true, override: "http://localhost:3000" })).toBe(
        "http://localhost:3000",
      );
      expect(resolveRewardsOrigin({ env, override: "http://localhost:3000" })).toBe(
        env === "test" ? "https://cf.z.ai" : "https://cf.z.ai",
      );
    }
  });
  it("只允许可信 origin 和精确 rewards 路径", () => {
    expect(resolveRewardsOrigin({ env: "production", override: "not-a-url" })).toBe(
      "https://cf.z.ai",
    );
    expect(isTrustedRewardsUrl("https://cf.z.ai/en/rewards?embedded=app")).toBe(true);
    for (const url of [
      "https://cf.z.ai.evil.test/en/rewards?embedded=app",
      "https://user@cf.z.ai/en/rewards?embedded=app",
      "https://cf.z.ai/en/rewards-fake?embedded=app",
      "https://cf.z.ai/en/rewards",
      "http://localhost:3000/en/rewards?embedded=app",
    ]) {
      expect(isTrustedRewardsUrl(url)).toBe(false);
    }
    expect(
      isTrustedRewardsUrl("http://localhost:3000/cn/rewards?embedded=app", { dev: true }),
    ).toBe(true);
  });
});
