import { describe, expect, it, vi } from "vitest";
import { isTarCommand, resolveHostTarCommand } from "../src/packaging/tarCommand.js";

function stubPlatform(platform: NodeJS.Platform) {
  vi.spyOn(process, "platform", "get").mockReturnValue(platform);
}

describe("resolveHostTarCommand", () => {
  it("Non-Windows hosts return PATH-resolved tar as-is; do not touch System32 (CR review regression).", () => {
    stubPlatform("linux");
    expect(resolveHostTarCommand()).toBe("tar");
    stubPlatform("darwin");
    expect(resolveHostTarCommand()).toBe("tar");
  });

  it("Windows 宿主缺失 System32 tar.exe 时 fail-fast，不回退 PATH", () => {
    stubPlatform("win32");
    const original = process.env.SystemRoot;
    process.env.SystemRoot = "Z:\\definitely-missing";
    try {
      expect(() => resolveHostTarCommand()).toThrow(/System32 tar\.exe missing/u);
    } finally {
      process.env.SystemRoot = original;
    }
  });

  it("isTarCommand matches both plain tar and System32 absolute path forms.", () => {
    expect(isTarCommand("tar")).toBe(true);
    expect(isTarCommand("C:\\Windows\\System32\\tar.exe")).toBe(true);
    expect(isTarCommand("/usr/bin/tar")).toBe(true);
    expect(isTarCommand("zip")).toBe(false);
  });
});
