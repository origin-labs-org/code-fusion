import { resolve } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

const processLifecycleTests = [
  "packages/services/test/processTreeTerminator.test.ts",
  "packages/services/test/cfAgentService.test.ts",
  "packages/services/test/cfAgentService.v4.test.ts",
  "packages/services/test/cfAgentProcessManager.test.ts",
  "packages/services/test/cfStdioTransport.test.ts",
];
const forkIsolatedTests = [
  ...processLifecycleTests,
  "packages/desktop/test/r3RemoteProcess.test.ts",
  "packages/provider-node/test/personal-config-read-lock.test.ts",
  "packages/services/src/gen-ui/adapters/stateStorage.test.ts",
  "packages/desktop/test/windowsInstallerCompile.test.ts",
  "packages/desktop/test/cdnPreloadScript.test.ts",
  "packages/desktop/test/desktopRuntimeEnv.test.ts",
  "packages/desktop/test/e2eDesktopBuildCache.test.ts",
  "packages/desktop/test/e2eSummarySpecCoverage.test.ts",
  "packages/desktop/test/migrateStableFeedScript.test.ts",
  "packages/desktop/test/pluginE2EAdmissionScripts.test.ts",
  "packages/desktop/test/uploadOssScript.test.ts",
  "packages/desktop/test/notarizeMacosScript.test.ts",
  "packages/desktop/test/publishReleaseScript.test.ts",
  "packages/web/test/remoteFrontendBuildSource.test.ts",
  "packages/desktop/test/dev-cua-plugin-runtime.test.ts",
  "packages/desktop/test/webRemoteControlTransport.test.ts",
  "packages/web/test/webRemoteControlTransport.test.ts",
  "packages/provider-node/test/builtin-provider-build.test.ts",
  "packages/provider-node/test/builtin-provider-test-config-sync.test.ts",
  "packages/server/test/remoteDeploy.test.ts",
  "packages/services/test/gitService.test.ts",
  "packages/services/test/gitCheckpointService.test.ts",
  "packages/services/test/mcpSyncService.test.ts",
  "packages/services/test/providerRuntimeResolver.test.ts",
  "packages/services/test/runtimeToolResolver.test.ts",
  "packages/cf-server-cli/test/runtimeUpdateIntegration.test.ts",
  // docs/windows-test-compatibility.md。
  "packages/ui/test/pdfJsCMapSupport.test.ts",
];

export default defineConfig({
  define: {
    __CF_TELEMETRY_REPORT_ENDPOINT__: JSON.stringify("https://cf.z.ai/api/v1/event/report"),
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "packages/ui/src"),
      "@desktop": resolve(__dirname, "packages/desktop/src"),
      "@web": resolve(__dirname, "packages/web/src"),
      "@arms/rum-electron/browser": resolve(
        __dirname,
        "packages/desktop/test/mocks/armsRumElectronStub.ts",
      ),
      "@arms/rum-electron": resolve(
        __dirname,
        "packages/desktop/test/mocks/armsRumElectronStub.ts",
      ),
    },
  },
  test: {
    setupFiles: ["./vitest.setup.ts"],
    forceRerunTriggers: [...configDefaults.forceRerunTriggers, "**/vitest.setup.ts"],
    silent: "passed-only",
    hookTimeout: 30_000,
    maxWorkers: 4,
    testTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: [
            "packages/*/test/**/*.test.ts",
            "packages/*/src/**/contract.test.ts",
            "packages/shared/src/node/genUiPaths.test.ts",
            "packages/services/src/gen-ui/**/*.test.ts",
            "scripts/assert-safe-cua-helper-zip.test.mjs",
            "scripts/ci/ci-telemetry-keyword-guard.test.mjs",
          ],
          exclude: ["packages/desktop/test/e2e/**/*.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "fork-isolated",
          include: forkIsolatedTests,
          pool: "forks",
          fileParallelism: false,
        },
      },
    ],
  },
});
