import {
  CF_AGENT_RUNTIME,
  CF_AGENT_PROVIDER,
  type RemoteResourcePackageId,
} from "@origin-ai/cf-shared";
import type { IRemoteBackend, RemoteEnvironment } from "@origin-ai/cf-server/remote/backend.js";
import {
  REMOTE_BASE,
  type DeployLoggers,
  type RemoteAssetDeployOptions,
  waitForClose,
} from "@origin-ai/cf-server/remote/deployShared.js";
import type { RemoteAssetInstaller } from "@origin-ai/cf-server/remote/remoteAssetInstaller.js";
import { buildWriteLiteralFileCommand } from "@origin-ai/cf-server/remote/posixShell.js";
import { deployDevelopmentCfAgentRuntime } from "@origin-ai/cf-server/remote/cfAgentDevDeploy.js";
import {
  buildRemoteAgentBundleWrapper,
  isRemoteAgentBundleWrapperCurrent,
  REMOTE_AGENT_BUNDLE_NAME,
} from "@origin-ai/cf-server/remote/cfAgentBundleWrapper.js";
import {
  deployRemoteAgentWrapper,
  isWslBackend,
} from "@origin-ai/cf-server/remote/cfAgentWrapperDeploy.js";
import {
  buildRemoteAgentOfficialPluginDir,
  buildRemoteAgentOfficialPluginRequiredPaths,
  buildRemoteAgentOfficialPluginSourceRelativePath,
  REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS,
} from "@origin-ai/cf-server/remote/cfAgentOfficialPluginAssets.js";
import { repairLegacyRemoteOfficialPluginDirectoryPermissions } from "@origin-ai/cf-server/remote/cfAgentOfficialPluginPermissionRepair.js";
import {
  checkRemoteAssetComponentIdentity,
  writeRemoteAssetComponentMeta,
} from "@origin-ai/cf-server/remote/remoteAssetLiveIdentity.js";

const REMOTE_AGENT_RUNTIME_BASE = `${REMOTE_BASE}/agents`;

export interface DeployCfAgentRuntimeOptions extends RemoteAssetDeployOptions {
  platformArch: string;
  installer: RemoteAssetInstaller;
  selectedResourcePackageIds?: RemoteResourcePackageId[];
  force?: boolean;
}

function isSelectedCfAgentComponent(
  componentId: string,
  selectedResourcePackageIds: readonly RemoteResourcePackageId[] | undefined,
): boolean {
  return (
    !selectedResourcePackageIds ||
    selectedResourcePackageIds.includes(componentId as RemoteResourcePackageId)
  );
}

async function shouldSkipCfAgentDeploy(params: {
  backend: IRemoteBackend;
  remoteBinaryPath: string;
  remoteBundlePath: string;
  runtimeResourceDir: string;
  expectedArtifactSha256: string | null;
  componentId: string;
  platformArch: string;
  force: boolean;
  missingOfficialPluginAssetPaths: string[];
  installer: RemoteAssetInstaller;
  loggers: DeployLoggers;
}): Promise<boolean> {
  if (params.force) {
    return false;
  }

  if (!params.expectedArtifactSha256) {
    params.loggers.logWarn(
      `[remote-assets] ${params.installer.mode === "remote-download" ? "download required" : "upload required"}: component=${params.componentId} reason=manifest SHA unavailable`,
    );
    return false;
  }

  const identityDecision = await checkRemoteAssetComponentIdentity(params.backend, {
    componentId: params.componentId,
    platformArch: params.platformArch,
    expectedIdentity: { sha256: params.expectedArtifactSha256 },
  });
  if (identityDecision.shouldDeploy) {
    params.loggers.logWarn(
      `[remote-assets] ${params.installer.mode === "remote-download" ? "download required" : "upload required"}: component=${params.componentId} reason=${identityDecision.reason}`,
    );
    return false;
  }

  if (!(await params.backend.exists(params.remoteBinaryPath))) {
    params.loggers.logWarn(
      `[remote-assets] ${params.installer.mode === "remote-download" ? "download required" : "upload required"}: component=${params.componentId} reason=remote wrapper missing path=${params.remoteBinaryPath}`,
    );
    return false;
  }

  if (isWslBackend(params.backend)) {
    try {
      const remoteWrapper = await params.backend.readFile(params.remoteBinaryPath);
      if (!isRemoteAgentBundleWrapperCurrent(remoteWrapper, params.runtimeResourceDir)) {
        params.loggers.logWarn(
          `[remote-assets] ${params.installer.mode === "remote-download" ? "download required" : "upload required"}: component=${params.componentId} reason=wsl wrapper stale path=${params.remoteBinaryPath}`,
        );
        return false;
      }
    } catch {
      return false;
    }
  }

  if (!(await params.backend.exists(params.remoteBundlePath))) {
    params.loggers.logWarn(
      `[remote-assets] ${params.installer.mode === "remote-download" ? "download required" : "upload required"}: component=${params.componentId} reason=remote bundle missing path=${params.remoteBundlePath}`,
    );
    return false;
  }

  if (params.missingOfficialPluginAssetPaths.length > 0) {
    params.loggers.logWarn(
      `[remote-assets] ${params.installer.mode === "remote-download" ? "download required" : "upload required"}: component=${params.componentId} reason=official plugin assets missing paths=${params.missingOfficialPluginAssetPaths.join(",")}`,
    );
    return false;
  }

  params.loggers.log(
    `[cf-agent-deploy] ${CF_AGENT_PROVIDER}: 制品 SHA ${params.expectedArtifactSha256} 已部署，Skip`,
  );
  return true;
}

async function findMissingRemoteOfficialPluginAssetPaths(
  backend: IRemoteBackend,
  remoteProviderDir: string,
): Promise<string[]> {
  const missingPaths: string[] = [];
  for (const remotePath of buildRemoteAgentOfficialPluginRequiredPaths(remoteProviderDir)) {
    if (!(await backend.exists(remotePath))) {
      missingPaths.push(remotePath);
    }
  }
  return missingPaths;
}

export async function deployCfAgentRuntime(
  backend: IRemoteBackend,
  env: RemoteEnvironment,
  options: DeployCfAgentRuntimeOptions,
  loggers: DeployLoggers,
): Promise<void> {
  const provider = CF_AGENT_PROVIDER;
  const runtime = CF_AGENT_RUNTIME;
  const componentId = provider;
  if (!isSelectedCfAgentComponent(componentId, options.selectedResourcePackageIds)) {
    loggers.log(`[cf-agent-deploy] ${provider}: None selected资源包 ${componentId}，SkipCheckand部署`);
    return;
  }

  const binaryName = runtime.resolveEntrySegments(env.platform).at(-1);
  if (!binaryName) {
    loggers.logWarn(`[cf-agent-deploy] ${provider}: 无法解析 agent 入口Name，Skip部署`);
    return;
  }

  const remoteProviderDir = `${REMOTE_AGENT_RUNTIME_BASE}/${runtime.bundledResourceDir}`;
  const remoteVersionFile = `${remoteProviderDir}/.version`;
  const remoteBinaryPath = `${remoteProviderDir}/${binaryName}`;
  const remoteBundlePath = `${remoteProviderDir}/${REMOTE_AGENT_BUNDLE_NAME}`;
  const remoteOfficialPluginDir = buildRemoteAgentOfficialPluginDir(remoteProviderDir);
  const missingOfficialPluginAssetPaths = await findMissingRemoteOfficialPluginAssetPaths(
    backend,
    remoteProviderDir,
  );

  if (
    await deployDevelopmentCfAgentRuntime(
      backend,
      {
        runtimeVersion: runtime.version,
        runtimeResourceDir: runtime.bundledResourceDir,
        remoteProviderDir,
        remoteVersionFile,
        remoteBinaryPath,
        force: Boolean(options.force),
      },
      loggers,
    )
  ) {
    return;
  }

  let expectedArtifactSha256: string | null = null;
  try {
    expectedArtifactSha256 =
      (await options.installer.resolveComponentSha256?.(componentId)) ?? null;
  } catch (error) {
    loggers.logWarn(
      `[cf-agent-deploy] ${provider}: Read manifest SHA Failed，k重New部署: ${String(error)}`,
    );
  }

  if (
    await shouldSkipCfAgentDeploy({
      backend,
      remoteBinaryPath,
      remoteBundlePath,
      runtimeResourceDir: runtime.bundledResourceDir,
      expectedArtifactSha256,
      componentId,
      platformArch: options.platformArch,
      force: Boolean(options.force),
      missingOfficialPluginAssetPaths,
      installer: options.installer,
      loggers,
    })
  ) {
    return;
  }

  loggers.log(`[cf-agent-deploy] ${provider}: Start部署 v${runtime.version}...`);
  const forceRefreshRuntimeAsset = Boolean(options.force);
  const permissionRepairSucceeded = await repairLegacyRemoteOfficialPluginDirectoryPermissions({
    backend,
    loggers,
    remoteOfficialPluginDir,
  });
  const installBundle = () =>
    options.installer.installFile({
      componentId,
      sourceRelativePath: `${runtime.bundledResourceDir}/${options.platformArch}/${REMOTE_AGENT_BUNDLE_NAME}`,
      remotePath: remoteBundlePath,
      executable: false,
      forceRefresh: forceRefreshRuntimeAsset,
    });
  const installOfficialPluginPackages = () =>
    options.installer.installDirectory({
      componentId,
      sourceRelativePath: buildRemoteAgentOfficialPluginSourceRelativePath({
        runtimeResourceDir: runtime.bundledResourceDir,
        platformArch: options.platformArch,
      }),
      remoteDir: remoteOfficialPluginDir,
      requiredRelativePaths: [...REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS],
      forceRefresh: forceRefreshRuntimeAsset,
    });

  if (permissionRepairSucceeded) {
    await installBundle();
    await installOfficialPluginPackages();
  } else {
    await installOfficialPluginPackages();
    await installBundle();
  }
  await deployRemoteAgentWrapper({
    backend,
    content: buildRemoteAgentBundleWrapper(runtime.bundledResourceDir),
    remoteWrapperPath: remoteBinaryPath,
  });

  const versionStream = await backend.exec(
    buildWriteLiteralFileCommand(remoteVersionFile, runtime.version),
  );
  await waitForClose(versionStream);
  if (expectedArtifactSha256) {
    await writeRemoteAssetComponentMeta(backend, {
      id: componentId,
      version: runtime.version,
      sha256: expectedArtifactSha256,
      platformArch: options.platformArch,
    });
  }
  loggers.log(`[cf-agent-deploy] ${provider}: 部署Completed v${runtime.version}`);
}
