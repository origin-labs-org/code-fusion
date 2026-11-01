import { describe, expect, it } from "vitest";
import {
  detectArchitectureMismatch,
  formatArchitectureMismatchDialogText,
  resolveArchitectureDownloadUrl,
} from "../src/main/desktopArchitectureGuard.js";

describe("detectArchitectureMismatch", () => {
  it("Running x64 package on Apple silicon (Rosetta translation) should be determined as mismatch", () => {
    expect(
      detectArchitectureMismatch({
        platform: "darwin",
        binaryArch: "x64",
        runningUnderARM64Translation: true,
      }),
    ).toEqual({ binaryArch: "x64", nativeArch: "arm64" });
  });

  it("Running under emulation on Windows on ARM should also be determined as mismatch", () => {
    expect(
      detectArchitectureMismatch({
        platform: "win32",
        binaryArch: "x64",
        runningUnderARM64Translation: true,
      }),
    ).toEqual({ binaryArch: "x64", nativeArch: "arm64" });
  });

  it("原生运行（未转译）应返回 null", () => {
    expect(
      detectArchitectureMismatch({
        platform: "darwin",
        binaryArch: "arm64",
        runningUnderARM64Translation: false,
      }),
    ).toBeNull();
  });

  it("Non-macOS/Windows platforms should not falsely report even if translation is indicated", () => {
    expect(
      detectArchitectureMismatch({
        platform: "linux",
        binaryArch: "x64",
        runningUnderARM64Translation: true,
      }),
    ).toBeNull();
  });
});

describe("resolveArchitectureDownloadUrl", () => {
  it("Direct to official website download page by language", () => {
    expect(resolveArchitectureDownloadUrl("zh-CN")).toBe("https://cf.z.ai/cn");
    expect(resolveArchitectureDownloadUrl("en-US")).toBe("https://cf.z.ai/en");
  });
});

describe("formatArchitectureMismatchDialogText", () => {
  const mismatch = { binaryArch: "x64", nativeArch: "arm64" } as const;

  it("Chinese copy includes running architecture and recommended architecture", () => {
    const text = formatArchitectureMismatchDialogText(mismatch, "zh-CN");
    expect(text.title).toBe("Architecture Mismatch");
    expect(text.detail).toContain("x64");
    expect(text.detail).toContain("arm64");
    expect(text.downloadButton).toBe("Download");
  });

  it("English copy includes running architecture and recommended architecture", () => {
    const text = formatArchitectureMismatchDialogText(mismatch, "en-US");
    expect(text.title).toBe("Architecture Mismatch");
    expect(text.detail).toContain("x64");
    expect(text.detail).toContain("arm64");
    expect(text.downloadButton).toBe("Download");
  });
});
