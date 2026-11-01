import { describe, expect, it } from "vitest";
import {
  createDesktopNativePackagePrunePatterns,
  findDesktopNativePackageViolations,
  parseAsarListWithPackState,
} from "../scripts/desktop-native-package-policy.mjs";

describe("desktop native package policy", () => {
  it("应裁剪 Canvas、node-pty 安装机产物和所有非目标平台 prebuild", () => {
    const patterns = createDesktopNativePackagePrunePatterns("darwin-arm64");

    expect(patterns).toContain("!node_modules/@napi-rs/canvas/**");
    expect(patterns).toContain("!node_modules/@napi-rs/canvas-*/**");
    expect(patterns).toContain("!node_modules/@lydell/node-pty-*/**");
    expect(patterns).toContain("!node_modules/node-pty/build/**");
    expect(patterns).toContain("!node_modules/node-pty/bin/**");
    expect(patterns).toContain("!node_modules/node-pty/prebuilds/darwin-x64/**");
    expect(patterns).toContain("!node_modules/node-pty/prebuilds/win32-arm64/**");
    expect(patterns).not.toContain("!node_modules/node-pty/prebuilds/darwin-arm64/**");
  });

  it("Should accept native resources containing only the target platform and properly unpacked", () => {
    const entries = parseAsarListWithPackState(
      [
        "unpack : /node_modules/node-pty/prebuilds/darwin-arm64/pty.node",
        "unpack : /node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
        "pack   : /node_modules/node-pty/package.json",
      ].join("\n"),
    );

    expect(findDesktopNativePackageViolations(entries, "darwin-arm64")).toEqual([]);
  });

  it("Should reject multi-platform packages, builder artifacts, and native resources remaining in asar payload", () => {
    const entries = parseAsarListWithPackState(
      [
        "pack   : \\node_modules\\@napi-rs\\canvas-win32-x64-msvc\\skia.node",
        "unpack : /node_modules/@lydell/node-pty-linux-x64/prebuilds/linux-x64/pty.node",
        "unpack : /node_modules/node-pty/build/Release/pty.node",
        "unpack : /node_modules/node-pty/prebuilds/win32-x64/pty.node",
        "pack   : /node_modules/node-pty/prebuilds/darwin-arm64/pty.node",
      ].join("\n"),
    );

    expect(findDesktopNativePackageViolations(entries, "darwin-arm64")).toEqual([
      expect.stringContaining("Canvas native"),
      expect.stringContaining("平台源包"),
      expect.stringContaining("安装机生成"),
      expect.stringContaining("非目标平台"),
      expect.stringContaining("packed payload"),
    ]);
  });
});
