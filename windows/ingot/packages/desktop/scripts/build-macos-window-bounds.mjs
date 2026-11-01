#!/usr/bin/env node
//

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(packageRoot, "native", "macos-window-bounds", "main.swift");
const outputDir = join(packageRoot, "resources", "macos-window-bounds");
const outputPath = join(outputDir, "cf-window-bounds");

if (process.platform !== "darwin") {
  console.log("[window-bounds] Skipped: required for macOS only.");
  process.exit(0);
}

if (!existsSync(sourcePath)) {
  console.error(`[window-bounds] 源File缺失：${sourcePath}`);
  process.exit(1);
}

function hasSwiftc() {
  try {
    execFileSync("xcrun", ["--find", "swiftc"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (!hasSwiftc()) {
  console.warn("[window-bounds] swiftc not found (requires Xcode Command Line Tools); skipping build.");
  console.warn("[window-bounds] Permission float window remains available but will not attach to System Settings window.");
  process.exit(0);
}

mkdirSync(outputDir, { recursive: true });

try {
  execFileSync(
    "xcrun",
    ["swiftc", "-O", "-target", "arm64-apple-macos11", sourcePath, "-o", `${outputPath}-arm64`],
    { stdio: "inherit" },
  );
  execFileSync(
    "xcrun",
    ["swiftc", "-O", "-target", "x86_64-apple-macos11", sourcePath, "-o", `${outputPath}-x86_64`],
    { stdio: "inherit" },
  );
  execFileSync(
    "lipo",
    ["-create", `${outputPath}-arm64`, `${outputPath}-x86_64`, "-output", outputPath],
    { stdio: "inherit" },
  );
  execFileSync("rm", ["-f", `${outputPath}-arm64`, `${outputPath}-x86_64`]);
  console.log(`[window-bounds] 已构建 universal Two进制：${outputPath}`);
} catch (error) {
  console.warn(
    "[window-bounds] Build failed; permission float window remains available but will not attach:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(0);
}
