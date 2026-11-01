import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stageAgentBundle } from "../packages/desktop/scripts/stage-agent-bundle.mjs";
import { runCommand } from "./spawn-command.mjs";

process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ? process.env.NODE_OPTIONS + " " : ""}--max-old-space-size=8192`;
import { stageDevCuaPluginRuntime } from "./stage-dev-cua-plugin-runtime.mjs";
import { resolveBuiltinProviderBuildEnvironment } from "./builtin-provider-config.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const useTurboBuild = process.env.CF_DESKTOP_AGENT_BUILD_MODE === "turbo";
const useBootstrapWithRemoteBuild = process.env.CF_BOOTSTRAP_WITH_REMOTE === "1";
const pnpmRunEnv = {
  ...process.env,
  CF_ENV: await resolveBuiltinProviderBuildEnvironment({ root: repoRoot }),
  PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "false",
};
const cuaPluginRuntimeStagingEnv = {
  ...process.env,
  CF_CUA_DEV_MODE: "1",
};
const cliWorkspaceBuilds = [
  { packageName: "@origin-ai/cf-shared-types", packageDir: "shared-types" },
  { packageName: "@origin-ai/cf-contracts", packageDir: "contracts" },
  {
    packageName: "@origin-ai/cf-dynamic-workflow",
    packageDir: "dynamic-workflow",
    prepareScript: "scripts/generate-libs.mjs",
  },
  { packageName: "@origin-ai/cf-dynamic-workflow-runtime", packageDir: "dynamic-workflow-runtime" },
  { packageName: "@origin-ai/cf-core", packageDir: "core" },
  { packageName: "@origin-ai/cf-adapters", packageDir: "adapters" },
  { packageName: "@origin-ai/cf-i18n", packageDir: "i18n" },
  { packageName: "@origin-ai/cf-telemetry", packageDir: "telemetry" },
  { packageName: "@origin-ai/cf-bootstrap", packageDir: "bootstrap" },
];
const requiredDevPluginRuntimeBuilds = [
  {
    packageName: "@origin-ai/cf-android-emulator-plugin",
    artifactPath: "android-emulator-plugin/dist/mcp/server.js",
  },
  {
    packageName: "@origin-ai/cf-ios-simulator-plugin",
    artifactPath: "ios-simulator-plugin/dist/mcp/server.js",
  },
  {
    packageName: "@origin-ai/cf-node-repl-host",
    artifactPath: "node-repl-host/dist/mcp/server.js",
  },
  {
    packageName: "@origin-ai/cf-browser-use-plugin",
    artifactPath: "browser-use-plugin/scripts/browser-client.mjs",
  },
  ...["documents", "pdf", "presentations", "spreadsheets"].map((name) => ({
    packageName: `@origin-ai/cf-${name}-plugin`,
    artifactPath: `${name}-plugin/dist/server.mjs`,
  })),
];
const defaultBuildFilters = [
  ...cliWorkspaceBuilds.map(({ packageName }) => packageName),
  ...requiredDevPluginRuntimeBuilds.map(({ packageName }) => packageName),
];

async function verifyRequiredDevPluginRuntimeArtifacts() {
  for (const runtime of requiredDevPluginRuntimeBuilds) {
    const artifactPath = resolve(repoRoot, "apps/cli/packages", runtime.artifactPath);
    try {
      await access(artifactPath);
    } catch (error) {
      throw new Error(
        `[build-desktop-agent-cli] ${runtime.packageName} build succeeded without required MCP runtime: ${artifactPath}`,
        { cause: error },
      );
    }
  }
}

function stageDevAgentBundle() {
  stageAgentBundle({
    repoRoot,
    platformKey: `${process.platform}-${process.arch}`,
  });
}

function runBootstrapWithRemoteBuild() {
  for (const { packageDir, prepareScript } of cliWorkspaceBuilds) {
    if (prepareScript) {
      runCommand(process.execPath, [prepareScript], {
        cwd: `apps/cli/packages/${packageDir}`,
        env: pnpmRunEnv,
        stdio: "inherit",
      });
    }
    runCommand(process.execPath, ["../../node_modules/typescript/bin/tsc"], {
      cwd: `apps/cli/packages/${packageDir}`,
      env: pnpmRunEnv,
      stdio: "inherit",
    });
  }

  runCommand(process.execPath, ["scripts/build.mjs", "--desktop-agent"], {
    cwd: "apps/cli/packages/cli",
    env: pnpmRunEnv,
    stdio: "inherit",
  });
}

if (useBootstrapWithRemoteBuild) {
  runBootstrapWithRemoteBuild();
  stageDevAgentBundle();
  stageDevCuaPluginRuntime({ env: cuaPluginRuntimeStagingEnv });
  process.exit(0);
}

if (!useTurboBuild) {
  for (const filter of defaultBuildFilters) {
    runCommand("pnpm", ["--filter", filter, "build"], {
      env: pnpmRunEnv,
      stdio: "inherit",
    });
  }

  await verifyRequiredDevPluginRuntimeArtifacts();
  runCommand("pnpm", ["--filter", "@origin-ai/cf-cli", "build:desktop-agent"], {
    env: pnpmRunEnv,
    stdio: "inherit",
  });
  stageDevAgentBundle();
  stageDevCuaPluginRuntime({ env: cuaPluginRuntimeStagingEnv });
  process.exit(0);
}

runCommand(
  "pnpm",
  [
    "exec",
    "turbo",
    "--skip-infer",
    "--cwd",
    "apps/cli",
    "run",
    "build:desktop-agent",
    "--filter=@origin-ai/cf-cli",
  ],
  {
    env: pnpmRunEnv,
    stdio: "inherit",
  },
);
stageDevAgentBundle();
stageDevCuaPluginRuntime({ env: cuaPluginRuntimeStagingEnv });
