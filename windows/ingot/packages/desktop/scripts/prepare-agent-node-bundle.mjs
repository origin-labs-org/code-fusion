#!/usr/bin/env node

//
//

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runCommand } from "../../../scripts/spawn-command.mjs";
import { stageAgentBundle } from "./stage-agent-bundle.mjs";
import {
  isSharpRequiredByComputerUse,
  stageSharpIntoBundledAgents,
} from "./sharp-package-assets.mjs";
import { stageKoffiIntoBundledAgents } from "./koffi-package-assets.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");
const repoRoot = resolve(desktopRoot, "..", "..");
const cliBundlePath = resolve(repoRoot, "apps/cli/packages/cli/dist/cf.cjs");
const adaptersRoot = resolve(repoRoot, "apps/cli/packages/adapters");
const pnpmRunEnv = {
  ...process.env,
  PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "false",
};
const BROWSER_USE_PLUGIN_PACKAGE_NAME = "@origin-ai/cf-browser-use-plugin";
const NODE_REPL_HOST_PACKAGE_NAME = "@origin-ai/cf-node-repl-host";
const CUA_PLUGIN_PACKAGE_NAME = "@origin-ai/cf-cua-plugin";

function normalizePlatform(raw) {
  switch (raw) {
    case "mac":
    case "macos":
    case "darwin":
    case "osx":
      return "darwin";
    case "win":
    case "windows":
    case "win32":
      return "win32";
    case "linux":
      return "linux";
    default:
      return raw;
  }
}

function normalizeArch(raw) {
  switch (raw) {
    case "x86_64":
    case "x64":
    case "amd64":
      return "x64";
    case "aarch64":
    case "arm64":
      return "arm64";
    default:
      return raw;
  }
}

const platform = normalizePlatform(process.env.CF_TARGET_OS || "") || process.platform;
const arch = normalizeArch(process.env.CF_TARGET_ARCH || "") || process.arch;
const platformKey = `${platform}-${arch}`;

const glmDir = resolve(desktopRoot, "bundled-agents", platformKey, "glm");
const browserUseRequiredRuntimePaths = [
  "scripts/browser-client.mjs",
  "docs/api.json",
  "docs/documents.json",
  "docs/overview.md",
  "docs/recording.md",
  "docs/workflow.md",
  "skills/control-browser/SKILL.md",
  "skills/web-gui-tester/SKILL.md",
];
const officeViewerRuntimePaths = ["dist/server.mjs", "dist/ui/assets.json", "dist/ui/panel.html"];
const officialPluginPackages = [
  {
    packageName: "@origin-ai/cf-android-emulator-plugin",
    relativePath: "apps/cli/packages/android-emulator-plugin",
    requiresRuntime: true,
    requiredRuntimePaths: ["dist/mcp/server.js"],
    runtimeBuildScript: "scripts/build-mcp.mjs",
    stagedPath: "packages/android-emulator-plugin",
  },
  {
    packageName: "@origin-ai/cf-documents-plugin",
    relativePath: "apps/cli/packages/documents-plugin",
    requiresRuntime: true,
    requiredRuntimePaths: officeViewerRuntimePaths,
    requiredSeedPaths: [
      "agents/visual-judge.md",
      "skills/docx/SKILL.md",
      "skills/docx-viewer/SKILL.md",
    ],
    runtimeBuildScript: "../office-runtime/scripts/build.mjs",
    stagedPath: "packages/documents-plugin",
  },
  {
    packageName: "@origin-ai/cf-image-search-plugin",
    relativePath: "apps/cli/packages/image-search-plugin",
    requiresRuntime: false,
    requiredSeedPaths: [".mcp.json"],
    stagedPath: "packages/image-search-plugin",
  },
  {
    packageName: "@origin-ai/cf-pdf-plugin",
    relativePath: "apps/cli/packages/pdf-plugin",
    requiresRuntime: true,
    requiredRuntimePaths: officeViewerRuntimePaths,
    requiredSeedPaths: [
      "agents/visual-judge.md",
      "skills/pdf/SKILL.md",
      "skills/pdf-viewer/SKILL.md",
    ],
    runtimeBuildScript: "../office-runtime/scripts/build.mjs",
    stagedPath: "packages/pdf-plugin",
  },
  {
    packageName: "@origin-ai/cf-presentations-plugin",
    relativePath: "apps/cli/packages/presentations-plugin",
    requiresRuntime: true,
    requiredRuntimePaths: officeViewerRuntimePaths,
    requiredSeedPaths: [
      "agents/visual-judge.md",
      "skills/pptx/SKILL.md",
      "skills/pptx-viewer/SKILL.md",
    ],
    runtimeBuildScript: "../office-runtime/scripts/build.mjs",
    stagedPath: "packages/presentations-plugin",
  },
  {
    packageName: "@origin-ai/cf-spreadsheets-plugin",
    relativePath: "apps/cli/packages/spreadsheets-plugin",
    requiresRuntime: true,
    requiredRuntimePaths: officeViewerRuntimePaths,
    requiredSeedPaths: [
      "agents/visual-judge.md",
      "skills/xlsx/SKILL.md",
      "skills/xlsx-viewer/SKILL.md",
    ],
    runtimeBuildScript: "../office-runtime/scripts/build.mjs",
    stagedPath: "packages/spreadsheets-plugin",
  },
  {
    packageName: "@origin-ai/cf-visualize-plugin",
    relativePath: "apps/cli/packages/visualize-plugin",
    requiresRuntime: false,
    requiredSeedPaths: [
      "skills/visualize/SKILL.md",
      "skills/visualize/references/api.md",
      "skills/visualize/references/styles.md",
      "skills/visualize/tweak.md",
      "skills/visualize/LICENSE.md",
      "skills/visualize/scripts/render.py",
      "skills/visualize/assets/visualize.css",
      "skills/visualize/assets/visualize.html",
      "skills/visualize/assets/calendar.js",
      "skills/visualize/assets/runtime-manifest.json",
      "skills/visualize/scripts/vendor.py",
      "skills/visualize/assets/vendor/manifest.json",
      "skills/visualize/assets/vendor/floating-ui-core-1.7.3.min.js",
      "skills/visualize/assets/vendor/floating-ui-core-1.7.3.min.js.LICENSE",
      "skills/visualize/assets/vendor/floating-ui-dom-1.7.4.min.js",
      "skills/visualize/assets/vendor/floating-ui-dom-1.7.4.min.js.LICENSE",
      "skills/visualize/assets/vendor/lucide-1.17.0.js",
      "skills/visualize/assets/vendor/lucide-1.17.0.js.LICENSE",
      "skills/visualize/assets/vendor/d3-7.9.0.min.js",
      "skills/visualize/assets/vendor/d3-7.9.0.min.js.LICENSE",
      "skills/visualize/widgets/calendar.md",
      "skills/visualize/examples/calendar.html",
      "skills/visualize/assets/standalone-host-bridge.js",
      "skills/visualize/assets/standalone-shell.js",
    ],
    requiredRuntimePaths: [],
    stagedPath: "packages/visualize-plugin",
  },
  {
    packageName: "@origin-ai/cf-browser-use-plugin",
    relativePath: "apps/cli/packages/browser-use-plugin",
    requiresRuntime: true,
    requiredRuntimePaths: browserUseRequiredRuntimePaths,
    runtimeBuildScript: "scripts/build.mjs",
    stagedPath: "packages/browser-use-plugin",
  },
  {
    packageName: "@origin-ai/cf-ios-simulator-plugin",
    relativePath: "apps/cli/packages/ios-simulator-plugin",
    requiresRuntime: true,
    requiredRuntimePaths: ["dist/mcp/server.js"],
    runtimeBuildScript: "scripts/build-mcp.mjs",
    stagedPath: "packages/ios-simulator-plugin",
  },
  {
    packageName: "@origin-ai/cf-restore-legacy-sessions-plugin",
    relativePath: "apps/cli/packages/restore-legacy-sessions-plugin",
    requiresRuntime: false,
    stagedPath: "packages/restore-legacy-sessions-plugin",
  },
  {
    packageName: "@origin-ai/cf-skill-creator-plugin",
    relativePath: "apps/cli/packages/skill-creator-plugin",
    requiresRuntime: false,
    stagedPath: "packages/skill-creator-plugin",
  },
  {
    packageName: "@origin-ai/cf-plugin-creator-plugin",
    relativePath: "apps/cli/packages/plugin-creator-plugin",
    requiresRuntime: false,
    stagedPath: "packages/plugin-creator-plugin",
  },
  {
    packageName: "@origin-ai/cf-guide-plugin",
    relativePath: "apps/cli/packages/cf-guide-plugin",
    requiresRuntime: false,
    stagedPath: "packages/cf-guide-plugin",
  },
  {
    packageName: "@origin-ai/cf-node-repl-host",
    relativePath: "apps/cli/packages/node-repl-host",
    requiresRuntime: true,
    requiredRuntimePaths: ["dist/mcp/server.js"],
    runtimeBuildScript: "scripts/build.mjs",
    stagedPath: "packages/node-repl-host",
  },
  {
    packageName: "@origin-ai/cf-cua-plugin",
    relativePath: "apps/cli/packages/cf-cua-plugin",
    requiresRuntime: false,
    stagedPath: "packages/cf-cua-plugin",
  },
];
const bundledSkillPack = {
  relativePath: "apps/cli/packages/bundled-skills",
  requiredPaths: [
    "skills/dynamic-workflows/SKILL.md",
    "skills/dynamic-workflows/patterns.md",
    "skills/dynamic-workflows/examples.md",
  ],
  stagedPath: "packages/bundled-skills",
  topLevelPaths: ["README.md", "skills"],
};
const includedOfficialPluginTopLevelPaths = new Set([
  ".mcp.json",
  ".cf-plugin",
  "README.md",
  "agents",
  "commands",
  "dist",
  "docs",
  "hooks",
  "output-styles",
  "package.json",
  "scripts",
  "skills",
  "templates",
]);
const excludedOfficialPluginAssetNames = new Set([
  ".DS_Store",
  ".venv",
  "__pycache__",
  "node_modules",
]);

function shouldCopyOfficialPluginAsset(sourcePath) {
  const name = basename(sourcePath);
  return !excludedOfficialPluginAssetNames.has(name) && !name.endsWith(".pyc");
}
const isBootstrapWithRemote = process.env.CF_BOOTSTRAP_WITH_REMOTE === "1";

function buildCliBundle() {
  console.log("[prepare:agent-bundle] building cf-cli app-server bundle ...");
  runCommand(process.execPath, [resolve(repoRoot, "scripts/build-desktop-agent-cli.mjs")], {
    cwd: repoRoot,
    env: pnpmRunEnv,
  });
  if (!existsSync(cliBundlePath)) {
    throw new Error(
      `[prepare:agent-bundle] expected cli bundle missing after build: ${cliBundlePath}`,
    );
  }
}

function buildOfficialPluginRuntimes() {
  for (const plugin of officialPluginPackages) {
    if (!plugin.requiresRuntime) continue;
    console.log(`[prepare:agent-bundle] building ${plugin.packageName} runtime ...`);
    if (isBootstrapWithRemote) {
      buildOfficialPluginRuntimeForBootstrap(plugin);
      assertOfficialPluginRuntime(plugin);
      continue;
    }

    runCommand(
      "pnpm",
      ["--dir", resolve(repoRoot, "apps/cli"), "--filter", plugin.packageName, "build"],
      {
        cwd: repoRoot,
        env: pnpmRunEnv,
      },
    );
    assertOfficialPluginRuntime(plugin);
  }
}

function buildOfficialPluginRuntimeForBootstrap(plugin) {
  const pluginRoot = resolve(repoRoot, plugin.relativePath);
  rmSync(resolve(pluginRoot, "dist"), { recursive: true, force: true });
  if (existsSync(resolve(pluginRoot, "tsconfig.json"))) {
    runCommand(process.execPath, ["../../node_modules/typescript/bin/tsc"], {
      cwd: pluginRoot,
      env: process.env,
    });
  }
  runCommand(process.execPath, [plugin.runtimeBuildScript], {
    cwd: pluginRoot,
    env: process.env,
  });
}

function assertOfficialPluginRuntime(plugin) {
  const pluginRoot = resolve(repoRoot, plugin.relativePath);
  for (const relativePath of plugin.requiredRuntimePaths) {
    const runtimePath = resolve(pluginRoot, ...relativePath.split("/"));
    if (!existsSync(runtimePath)) {
      throw new Error(`[prepare:agent-bundle] missing official plugin runtime: ${runtimePath}`);
    }
  }
}

function stageBundle() {
  stageAgentBundle({ repoRoot, platformKey });
}

function stageOfficialPlugins() {
  for (const plugin of officialPluginPackages) {
    const sourceRoot = resolve(repoRoot, plugin.relativePath);
    const manifestPath = resolve(sourceRoot, ".cf-plugin", "plugin.json");
    if (!existsSync(manifestPath)) {
      throw new Error(`[prepare:agent-bundle] missing official plugin manifest: ${manifestPath}`);
    }

    const targetRoot = resolve(glmDir, plugin.stagedPath);
    mkdirSync(targetRoot, { recursive: true });
    for (const entryName of includedOfficialPluginTopLevelPaths) {
      const sourcePath = resolve(sourceRoot, entryName);
      if (!existsSync(sourcePath)) continue;
      cpSync(sourcePath, resolve(targetRoot, entryName), {
        recursive: true,
        filter: shouldCopyOfficialPluginAsset,
      });
    }
    for (const relativePath of plugin.requiredSeedPaths ?? []) {
      const stagedAssetPath = resolve(targetRoot, ...relativePath.split("/"));
      if (!existsSync(stagedAssetPath)) {
        throw new Error(
          `[prepare:agent-bundle] missing staged official plugin seed asset: ${stagedAssetPath}`,
        );
      }
    }
    console.log(`[prepare:agent-bundle] staged official plugin ${plugin.stagedPath}`);
  }
}

function stageBundledSkillPack() {
  const sourceRoot = resolve(repoRoot, bundledSkillPack.relativePath);
  const targetRoot = resolve(glmDir, bundledSkillPack.stagedPath);
  mkdirSync(targetRoot, { recursive: true });
  for (const entryName of bundledSkillPack.topLevelPaths) {
    const sourcePath = resolve(sourceRoot, entryName);
    if (!existsSync(sourcePath)) continue;
    cpSync(sourcePath, resolve(targetRoot, entryName), {
      recursive: true,
      filter: shouldCopyOfficialPluginAsset,
    });
  }
  for (const relativePath of bundledSkillPack.requiredPaths) {
    const stagedAssetPath = resolve(targetRoot, ...relativePath.split("/"));
    if (!existsSync(stagedAssetPath)) {
      throw new Error(
        `[prepare:agent-bundle] missing staged bundled skill asset: ${stagedAssetPath}`,
      );
    }
  }
  console.log(`[prepare:agent-bundle] staged bundled skill pack ${bundledSkillPack.stagedPath}`);
}

function stageSharpForNodeReplPlugin() {
  if (!isSharpRequiredByComputerUse({ desktopPackageRoot: desktopRoot })) {
    console.log(
      "[prepare:agent-bundle] Computer Use package does not declare sharp, skip sharp staging",
    );
    return;
  }
  const pluginStagedDirs = [
    [NODE_REPL_HOST_PACKAGE_NAME, resolve(glmDir, "packages", "node-repl-host")],
    [BROWSER_USE_PLUGIN_PACKAGE_NAME, resolve(glmDir, "packages", "browser-use-plugin")],
    [CUA_PLUGIN_PACKAGE_NAME, resolve(glmDir, "packages", "cf-cua-plugin")],
  ];
  for (const [packageName, pluginStagedDir] of pluginStagedDirs) {
    if (!existsSync(resolve(pluginStagedDir, ".cf-plugin", "plugin.json"))) {
      console.log(`[prepare:agent-bundle] ${packageName} not staged, skip sharp staging`);
      continue;
    }
    stageSharpIntoBundledAgents({
      desktopPackageRoot: desktopRoot,
      glmDir: pluginStagedDir,
      targetPlatform: { os: platform, arch },
    });
    console.log(
      `[prepare:agent-bundle] staged sharp into ${resolve(pluginStagedDir, "node_modules")} (${platform}-${arch})`,
    );
  }
}

function stageKoffiForCuaPlugin() {
  const cuaPluginStagedDir = resolve(glmDir, "packages", "cf-cua-plugin");
  if (!existsSync(resolve(cuaPluginStagedDir, ".cf-plugin", "plugin.json"))) {
    console.log("[prepare:agent-bundle] cf-cua-plugin not staged, skip koffi staging");
    return;
  }
  stageKoffiIntoBundledAgents({
    koffiPackageRoot: adaptersRoot,
    glmDir: cuaPluginStagedDir,
    targetPlatform: { os: platform, arch },
  });
  console.log(
    `[prepare:agent-bundle] staged koffi into ${resolve(cuaPluginStagedDir, "node_modules")} (${platform}-${arch})`,
  );
}

buildCliBundle();
buildOfficialPluginRuntimes();
stageBundle();
stageOfficialPlugins();
stageBundledSkillPack();
stageKoffiForCuaPlugin();
stageSharpForNodeReplPlugin();
