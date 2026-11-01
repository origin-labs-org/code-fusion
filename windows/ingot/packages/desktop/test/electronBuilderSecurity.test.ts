import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("Windows packaging disables Node Inspector, keeping RunAsNode required by Agent", async () => {
  vi.stubEnv("CF_TARGET_OS", "win32");
  const { default: config } = await import("../electron-builder.config.js");

  expect(config.electronFuses?.enableNodeCliInspectArguments).toBe(false);
  expect(config.electronFuses?.runAsNode).toBeUndefined();
});

it.each(["darwin", "linux"])("%s 保留现有 fuse 配置", async (platform) => {
  vi.stubEnv("CF_TARGET_OS", platform);
  const { default: config } = await import("../electron-builder.config.js");

  expect(config.electronFuses).toBeUndefined();
});
