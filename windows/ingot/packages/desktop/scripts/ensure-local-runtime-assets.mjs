#!/usr/bin/env node

import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import {
  resolveNativeSearchBuildPlan,
  resolveNativeSearchReleasePlan,
} from "../../../scripts/native-search-tools-config.mjs";
import { verifyBuiltNativeSearchTools } from "../../../scripts/native-search-tools-verify.mjs";
import { runCommand } from "../../../scripts/spawn-command.mjs";
import { getTargetPlatform } from "./target-platform.mjs";

const desktopRoot = resolve(import.meta.dirname, "..");
const target = getTargetPlatform();
const bundledToolsRoot = join(desktopRoot, "bundled-tools", target.key);
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const nativeSearchReleasePlan = resolveNativeSearchReleasePlan({
  platform: target.os,
  arch: target.arch,
});
const nativeSearchBuildPlan = nativeSearchReleasePlan.enabled
  ? resolveNativeSearchBuildPlan({
      platform: target.os,
      arch: target.arch,
      outputDir: bundledToolsRoot,
    })
  : undefined;
const shouldRequireWindowsBrowserImportHelper =
  target.os === "win32" && process.env.CF_ENABLE_WINDOWS_BROWSER_IMPORT === "1";
const shouldRequireMacosWindowBounds = target.os === "darwin";

function isNativeSearchReady() {
  if (!nativeSearchBuildPlan) return true;
  const requiredPaths = nativeSearchReleasePlan.runtimeToolIds.map(
    (toolId) => nativeSearchBuildPlan.binaries[toolId],
  );
  if (requiredPaths.some((binaryPath) => !binaryPath || !existsSync(binaryPath))) {
    return false;
  }

  try {
    verifyBuiltNativeSearchTools({
      bfsPath: nativeSearchBuildPlan.bfsPath,
      rgPath: nativeSearchBuildPlan.rgPath,
      ugrepPath: nativeSearchBuildPlan.ugrepPath,
      platform: nativeSearchBuildPlan.platform,
      arch: nativeSearchBuildPlan.arch,
    });
    return true;
  } catch (error) {
    console.warn(
      `[ensure-local-runtime-assets] embedded search validation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    for (const binaryPath of requiredPaths) {
      rmSync(binaryPath, { force: true });
    }
    return false;
  }
}

const REQUIRED_LOCAL_RUNTIME_ASSETS = [
  ...(nativeSearchReleasePlan.enabled
    ? [
        {
          label: "embedded search",
          script: "prepare:native-search",
          isReady: isNativeSearchReady,
        },
      ]
    : []),
  ...(shouldRequireWindowsBrowserImportHelper
    ? [
        {
          label: "Windows browser import helper",
          script: "prepare:browser-import-helper",
          isReady: () =>
            existsSync(join(bundledToolsRoot, "browser-import", "cf-browser-import-helper.exe")),
        },
      ]
    : []),
  ...(shouldRequireMacosWindowBounds
    ? [
        {
          label: "macOS window bounds helper",
          script: "prepare:macos-window-bounds",
          isReady: () =>
            existsSync(
              join(desktopRoot, "resources", "macos-window-bounds", "cf-window-bounds"),
            ),
        },
      ]
    : []),
];

const missingAssets = [];
for (const asset of REQUIRED_LOCAL_RUNTIME_ASSETS) {
  if (!(await asset.isReady())) {
    missingAssets.push(asset);
  }
}

if (missingAssets.length === 0) {
  console.log(`[ensure-local-runtime-assets] all local runtime assets are ready for ${target.key}`);
  process.exit(0);
}

for (const asset of missingAssets) {
  console.log(
    `[ensure-local-runtime-assets] preparing ${asset.label} because local runtime asset is missing or incomplete`,
  );
  runCommand(pnpmCommand, [asset.script], {
    cwd: desktopRoot,
    env: process.env,
  });
}
