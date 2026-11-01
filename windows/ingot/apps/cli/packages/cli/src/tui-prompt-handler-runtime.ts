import type { CfAppOptions } from "@origin-ai/cf-bootstrap";
import { loadBootstrapModule } from "./bootstrap-loader.js";
import { loadCliDotenv } from "./env.js";
import { createCliProviderRefreshReporter } from "./provider-runtime-env.js";
import { resolveResumeSession } from "./resume.js";
import type { CliResumeRequest, RunDependencies } from "./cli-types.js";

type ProviderRegistryRuntime = Awaited<
  ReturnType<NonNullable<RunDependencies["startProcessProviderRegistryRuntime"]>>
>;

interface TuiProcessRuntimeState {
  providerEndpointRoutingPort: CfAppOptions["providerEndpointRoutingPort"];
  providerRegistryRuntimePromise: Promise<ProviderRegistryRuntime> | undefined;
  shutdownTelemetry: (() => Promise<void>) | undefined;
}

export const createTuiProcessRuntimeState = (): TuiProcessRuntimeState => ({
  providerEndpointRoutingPort: undefined,
  providerRegistryRuntimePromise: undefined,
  shutdownTelemetry: undefined,
});

export async function prepareTuiAppRuntime(
  deps: RunDependencies,
  version: string,
  request: CliResumeRequest,
  state: TuiProcessRuntimeState,
) {
  const env = deps.env ?? process.env;
  const workingDirectory = (deps.cwd ?? process.cwd)();
  const dotenvResult = (deps.loadDotenv ?? loadCliDotenv)({
    cwd: workingDirectory,
    env,
  });

  if (dotenvResult.error) {
    throw new Error(`Failed to load environment file: ${dotenvResult.path}`, {
      cause: dotenvResult.error,
    });
  }

  const sessionId = await resolveResumeSession(request, workingDirectory, env, deps);
  const bootstrapModule = deps.createCfApp ? undefined : await loadBootstrapModule();
  const createAppFactory = deps.createCfApp ?? bootstrapModule?.createCfApp;
  if (!createAppFactory) throw new Error("CodeFusion app factory is unavailable.");
  const prepareTelemetry =
    deps.prepareCfTelemetryEnv ?? bootstrapModule?.prepareCfTelemetryEnv;
  if (prepareTelemetry) {
    state.shutdownTelemetry =
      deps.shutdownCfTelemetry ?? bootstrapModule?.shutdownCfTelemetry;
  }
  const appEnv = prepareTelemetry
    ? await prepareTelemetry(env, {
        cliVersion: version,
        productVersion: env.CF_APP_VERSION,
      })
    : env;
  const startProviderRegistryRuntime =
    deps.startProcessProviderRegistryRuntime ??
    bootstrapModule?.startProcessProviderRegistryRuntime;
  if (!startProviderRegistryRuntime) {
    throw new Error("Provider Registry runtime is unavailable.");
  }
  state.providerRegistryRuntimePromise ??= startProviderRegistryRuntime(
    appEnv,
    deps.skipUserConfig
      ? {}
      : {
          standalone: {
            ...createCliProviderRefreshReporter(),
            ...(deps.userConfigPath ? { legacyCliUserConfigFilePath: deps.userConfigPath } : {}),
          },
        },
  );
  const providerRegistryRuntime = await state.providerRegistryRuntimePromise;
  const configuredDefaultModelSelection = providerRegistryRuntime?.modelSelectionConfigRepository
    ? await providerRegistryRuntime.modelSelectionConfigRepository.read()
    : providerRegistryRuntime?.configuredDefaultModelSelection;
  const createProviderEndpointRoutingPort =
    deps.createProviderEndpointRoutingPort ??
    bootstrapModule?.createDefaultProviderEndpointRoutingPort;
  state.providerEndpointRoutingPort ??= createProviderEndpointRoutingPort?.({
    appVersion: version,
    env,
    projectConfigPath: deps.projectConfigPath,
    skipUserConfig: deps.skipUserConfig,
    userConfigPath: deps.userConfigPath,
    workingDirectory,
  });

  return {
    appEnv,
    configuredDefaultModelSelection,
    createAppFactory,
    providerRegistryRuntime,
    sessionId,
    workingDirectory,
  };
}
