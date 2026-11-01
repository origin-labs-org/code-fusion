import { describe, expect, it } from "vitest";
import enUS from "../src/i18n/locales/en-US.js";
import zhCN from "../src/i18n/locales/zh-CN.js";

describe("model provider Coding Plan i18n", () => {
  it("keeps Coding Plan message ids localized in zh-CN", () => {
    const prefix = "settings.modelProvider.codingPlan";
    const enKeys = Object.keys(enUS).filter((key) => key.startsWith(prefix));

    for (const key of enKeys) {
      expect(zhCN[key], `zh-CN missing ${key}`).toBeTruthy();
    }
  });
});
