#!/usr/bin/env node

import process from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { runCommand } from "./spawn-command.mjs";
import { clearHoistedPatchedDependencyTargets } from "./bootstrap-patched-dependencies.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const gitCommand = "git";
const withRemoteAssets = process.argv.includes("--with-remote");

function prependPathEntries(pathValue, entries) {
  const currentEntries = pathValue ? pathValue.split(delimiter) : [];
  return [...entries, ...currentEntries].join(delimiter);
}

function resolvePinnedNodeBin() {
  if (process.platform === "win32") {
    return undefined;
  }

  const miseConfigPath = resolve(rootDir, "mise.toml");
  if (!existsSync(miseConfigPath)) {
    return undefined;
  }

  const miseConfig = readFileSync(miseConfigPath, "utf8");
  const match = miseConfig.match(/^\s*node\s*=\s*"([^"]+)"/m);
  const version = match?.[1]?.trim();
  if (!version) {
    return undefined;
  }

  const nvmNodeBin = join(homedir(), ".nvm", "versions", "node", `v${version}`, "bin");
  return existsSync(nvmNodeBin) ? nvmNodeBin : undefined;
}

function resolveUserPnpmBin() {
  if (process.platform === "win32") {
    return undefined;
  }

  const pnpmBin = join(homedir(), "Library", "pnpm");
  return existsSync(join(pnpmBin, "pnpm")) ? pnpmBin : undefined;
}

function resolvePnpmCommand() {
  if (!withRemoteAssets) {
    return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  }

  const userPnpmBin = resolveUserPnpmBin();
  if (userPnpmBin) {
    return join(userPnpmBin, process.platform === "win32" ? "pnpm.cmd" : "pnpm");
  }

  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function resolveBootstrapWithRemoteEnv(baseEnv = process.env) {
  if (!withRemoteAssets) {
    return {};
  }

  const cfEnv = baseEnv.CF_ENV?.trim().toLowerCase() || "production";
  if (cfEnv !== "test" && cfEnv !== "production") {
    throw new Error(`Invalid CF_ENV for bootstrap:with-remote: ${cfEnv}`);
  }

  const pathEntries = [resolvePinnedNodeBin(), resolveUserPnpmBin()].filter(Boolean);

  return {
    CF_ENV: cfEnv,
    HUSKY: "0",
    PNPM_CONFIG_CONFIRM_MODULES_PURGE: "false",
    npm_config_confirm_modules_purge: "false",
    PNPM_CONFIG_WORKSPACE_CONCURRENCY: "1",
    CF_BOOTSTRAP_WITH_REMOTE: "1",
    ...(pathEntries.length > 0
      ? {
          PATH: prependPathEntries(baseEnv.PATH, pathEntries),
        }
      : {}),
  };
}

const bootstrapWithRemoteEnv = resolveBootstrapWithRemoteEnv();
const pnpmCommand = resolvePnpmCommand();

function runGit(args) {
  runCommand(gitCommand, args, {
    cwd: rootDir,
    env: process.env,
  });
}

function runPnpm(args, options = {}) {
  runCommand(pnpmCommand, args, {
    cwd: rootDir,
    env: {
      ...process.env,
      ...bootstrapWithRemoteEnv,
      ...options.env,
    },
  });
}

function runBootstrapServerBuild() {
  const serverDir = resolve(rootDir, "packages/server");

  runCommand(process.execPath, [resolve(rootDir, "node_modules/tsup/dist/cli-default.js")], {
    cwd: serverDir,
    env: {
      ...process.env,
      ...bootstrapWithRemoteEnv,
    },
  });
  runCommand(
    process.execPath,
    [resolve(rootDir, "node_modules/tsx/dist/cli.mjs"), "build-remote.ts"],
    {
      cwd: serverDir,
      env: {
        ...process.env,
        ...bootstrapWithRemoteEnv,
      },
    },
  );
}

function runBootstrapE2eReportBuild() {
  const e2eReportDir = resolve(rootDir, "packages/e2e-report");
  runCommand(
    process.execPath,
    [resolve(rootDir, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
    {
      cwd: e2eReportDir,
      env: {
        ...process.env,
        ...bootstrapWithRemoteEnv,
      },
    },
  );
  runCommand(process.execPath, [resolve(rootDir, "node_modules/vite/bin/vite.js"), "build"], {
    cwd: e2eReportDir,
    env: {
      ...process.env,
      ...bootstrapWithRemoteEnv,
    },
  });
}

function runBootstrapStreamAnimateBuild() {
  const streamAnimateDir = resolve(rootDir, "packages/stream-animate");
  runCommand(
    process.execPath,
    [resolve(rootDir, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.server.json"],
    {
      cwd: streamAnimateDir,
      env: {
        ...process.env,
        ...bootstrapWithRemoteEnv,
      },
    },
  );
  runCommand(process.execPath, [resolve(rootDir, "node_modules/vite/bin/vite.js"), "build"], {
    cwd: streamAnimateDir,
    env: {
      ...process.env,
      ...bootstrapWithRemoteEnv,
    },
  });
}

function runBootstrapDesktopBuild() {
  const desktopDir = resolve(rootDir, "packages/desktop");
  runCommand(process.execPath, ["scripts/build-metadata.mjs"], {
    cwd: desktopDir,
    env: {
      ...process.env,
      ...bootstrapWithRemoteEnv,
    },
  });
  console.log("[bootstrap:with-remote] skip desktop app bundle build; runtime assets are prepared");
}

function runBootstrapWithRemoteBuild() {
  for (const filter of ["@origin-ai/cf-rpc", "@origin-ai/cf-web", "@origin-ai/cf-formal-proof"]) {
    runPnpm(["--filter", filter, "build"]);
  }
  runBootstrapE2eReportBuild();
  runBootstrapStreamAnimateBuild();
  runBootstrapServerBuild();
  runBootstrapDesktopBuild();
}

runGit(["submodule", "update", "--init", "--recursive", "apps/cli"]);

const clearedPatchedDependencies = await clearHoistedPatchedDependencyTargets({
  rootDir,
  packageJsonPath: resolve(rootDir, "package.json"),
});
if (clearedPatchedDependencies.length > 0) {
  console.log(
    `[bootstrap] refreshed hoisted patched dependencies: ${clearedPatchedDependencies.join(", ")}`,
  );
}

runPnpm(withRemoteAssets ? ["install", "--config.confirmModulesPurge=false"] : ["install"]);

runPnpm(["prepare:desktop-runtime"]);

if (withRemoteAssets) {
  runBootstrapWithRemoteBuild();
  runPnpm(["--filter", "@origin-ai/cf-server-cli", "stage:remote-assets"]);
} else {
  runPnpm(["run", "build:bootstrap"]);
}
