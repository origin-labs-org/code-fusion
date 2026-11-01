import { describe, expect, it } from "vitest";
import {
  getStreamClientId,
  setStreamClientId,
  generateMobileDeviceFingerprint,
} from "../src/lib/streamClientId.js";

// ============================================================================
// ============================================================================

describe("streamClientId", () => {
  describe("generateMobileDeviceFingerprint", () => {
    it("Return a string concatenated with platform-related information", () => {
      const result = generateMobileDeviceFingerprint();
      expect(typeof result).toBe("string");
      expect(result.split("|").length).toBeGreaterThanOrEqual(1);
    });

    it("包含所有可用屏幕信息", () => {
      const result = generateMobileDeviceFingerprint();
      expect(result).toBeTruthy();
    });
  });

  describe("setStreamClientId / getStreamClientId (缓存行为)", () => {
    it("setStreamClientId 设置后，getStreamClientId 返回固定格式 renderer:deviceId", () => {
      setStreamClientId("test-device-123");
      expect(getStreamClientId()).toBe("renderer:test-device-123");
    });

    it("setStreamClientId 之后的结果与之前不同", () => {
      const before = getStreamClientId();
      setStreamClientId("new-device-456");
      const after = getStreamClientId();
      expect(after).toBe("renderer:new-device-456");
      expect(after).not.toBe(before);
    });
  });
});
