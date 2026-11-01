import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { isRealComputerUseProducerInstalled } from "../packages/desktop/scripts/computer-use-producer.mjs";
import { resolveDevDesktopWindowsCuaEnv } from "./dev-desktop-cua-env.mjs";
import { withPinnedNodePath } from "./mise-toolchain-env.mjs";
import { quoteArgsForWindowsShell } from "./spawn-command.mjs";

const requestedEnv = process.argv[2]?.trim().toLowerCase();
const agentBytecode = process.argv.slice(3).includes("--agent-bytecode");
if (requestedEnv !== "test" && requestedEnv !== "production") {
  console.error("Usage: node scripts/dev-desktop-env.mjs <test|production> [--agent-bytecode]");
  process.exit(1);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const hasComputerUseProducer = isRealComputerUseProducerInstalled({
  desktopPackageRoot: join(repoRoot, "packages", "desktop"),
});
const computerUseDevEnv = hasComputerUseProducer ? await resolveComputerUseDevEnv() : {};

async function resolveComputerUseDevEnv() {
  const { DEV_HELPER_APP_NAME } = await import("@origin-ai/cf-cua/broker/helperConstants");
  const sourceBuiltCuaHelperVersion = JSON.parse(
    readFileSync(join(repoRoot, "package.json"), "utf8"),
  ).version;
  if (typeof sourceBuiltCuaHelperVersion !== "string" || !sourceBuiltCuaHelperVersion.trim()) {
    throw new Error("Root package.json must define the Dev Computer Use Helper version");
  }
  const sourceBuiltCuaHelperApp = join(
    repoRoot,
    "packages",
    "desktop",
    "dist-cua-helper",
    DEV_HELPER_APP_NAME,
  );
  return {
    // Standard dev launch must test the Helper built from this checkout.
    // Falling back to ~/.cf can silently reuse a same-version stale
    // Helper and make native changes appear verified when they never ran.
    CF_CUA_BUNDLED_HELPER_APP_PATH: sourceBuiltCuaHelperApp,
    CF_CUA_HELPER_VERSION: sourceBuiltCuaHelperVersion,
    // Keep Dev Desktop separate from signed Stable/Preview and standalone MCP installs.
    CF_CUA_HELPER_INSTALL_VARIANT: "dev-desktop",
    ...(process.platform === "darwin" ? { CF_CUA_HELPER_ALLOW_UNSIGNED_LOCAL: "1" } : {}),
    ...resolveDevDesktopWindowsCuaEnv({
      platform: process.platform,
      repoRoot,
      env: process.env,
    }),
  };
}

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const spawnArgs = process.platform === "win32" ? quoteArgsForWindowsShell(args) : args;
    const child = spawn(command, spawnArgs, {
      cwd: repoRoot,
      env: withPinnedNodePath(
        {
          ...process.env,
          CF_ENV: requestedEnv,
          CF_DESKTOP_AGENT_BYTECODE: agentBytecode ? "1" : "0",
          ...computerUseDevEnv,
        },
        process.execPath,
      ),
      stdio: "inherit",
      // Windows .cmd/.bat executables (pnpm.cmd, npm.cmd, etc.) require shell: true
      shell: process.platform === "win32",
    });

    child.on("error", rejectRun);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(
        new Error(
          signal
            ? `${command} exited with signal ${signal}`
            : `${command} exited with code ${code ?? "unknown"}`,
        ),
      );
    });
  });
}

try {
  if (process.platform === "darwin" && hasComputerUseProducer) {
    await run(process.execPath, [
      resolve(repoRoot, "scripts/build-cua-helper-app.mjs"),
      "--allow-unsigned-launcher-local-dev",
    ]);
  }
  // The public dev scripts delegate here instead of invoking the package's
  // `dev` lifecycle directly, so pnpm will not run `pre-dev` automatically.
  // Preserve its runtime-asset preparation and stale `out` cleanup explicitly
  // before rebuilding bundles or starting Electron.
  await run(pnpmCommand, ["--filter", "@origin-ai/cf-desktop", "pre-dev"]);
  // On Windows, use "node" (resolved via PATHEXT) to avoid "C:\Program Files\..." space issues
  await run(process.platform === "win32" ? "node" : process.execPath, [
    resolve(repoRoot, "scripts/build-desktop-agent-cli.mjs"),
  ]);
  if (agentBytecode) {
    await run(process.platform === "win32" ? "node" : process.execPath, [
      resolve(repoRoot, "scripts/build-desktop-agent-bytecode.mjs"),
    ]);
  }
  await run(pnpmCommand, ["--filter", "@origin-ai/cf-desktop", "dev:runtime"]);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
