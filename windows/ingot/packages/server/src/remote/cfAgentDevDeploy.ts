
import { CF_AGENT_PROVIDER, resolveCfRuntimeEnv } from "@origin-ai/cf-shared";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { IRemoteBackend } from "@origin-ai/cf-server/remote/backend.js";
import {
  buildRemoteExecutableReplaceCommand,
  buildRemoteMoveCommand,
  type DeployLoggers,
  waitForClose,
} from "@origin-ai/cf-server/remote/deployShared.js";
import {
  buildWriteLiteralFileCommand,
  quotePosixPathArg,
  quotePosixShellArg,
} from "@origin-ai/cf-server/remote/posixShell.js";
import { createTarGzArchive } from "@origin-ai/cf-server/remote/localTarGz.js";
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
  REMOTE_AGENT_OFFICIAL_PLUGIN_DIR_NAME,
  REMOTE_AGENT_OFFICIAL_PLUGIN_INCLUDED_TOP_LEVEL_PATHS,
  REMOTE_AGENT_OFFICIAL_PLUGIN_PACKAGE_NAMES,
  REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS,
  buildRemoteAgentOfficialPluginDir,
  buildRemoteAgentOfficialPluginRequiredPaths,
} from "@origin-ai/cf-server/remote/cfAgentOfficialPluginAssets.js";
import { repairLegacyRemoteOfficialPluginDirectoryPermissions } from "@origin-ai/cf-server/remote/cfAgentOfficialPluginPermissionRepair.js";

const DEV_AGENT_BUNDLE_RELATIVE_PATH = "apps/cli/packages/cli/dist/cf.cjs";
const DEV_AGENT_BUNDLE_ENV = "CF_REMOTE_DEV_AGENT_BUNDLE";
const REMOTE_DEV_AGENT_BUNDLE_NAME = REMOTE_AGENT_BUNDLE_NAME;
const REMOTE_DEV_AGENT_VERSION_FILE_NAME = ".dev-version";

interface DeployDevelopmentCfAgentRuntimeParams {
  runtimeVersion: string;
  runtimeResourceDir: string;
  remoteProviderDir: string;
  remoteVersionFile: string;
  remoteBinaryPath: string;
  force: boolean;
}

function findUpward(relativePath: string): { rootDir: string; path: string } | null {
  let current = resolve(process.cwd());
  while (true) {
    const candidate = join(current, relativePath);
    if (existsSync(candidate)) {
      return { rootDir: current, path: candidate };
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function shouldUseDevelopmentAgentBundle(): boolean {
  if (resolveCfRuntimeEnv(process.env) !== "development") {
    return false;
  }

  const explicit = process.env[DEV_AGENT_BUNDLE_ENV]?.trim().toLowerCase();
  if (explicit === "0" || explicit === "false") {
    return false;
  }
  if (explicit === "1" || explicit === "true") {
    return true;
  }

  return !process.env.VITEST;
}

function resolveDevelopmentAgentBundle(): {
  repoRoot: string;
  localBundlePath: string;
} | null {
  if (!shouldUseDevelopmentAgentBundle()) {
    return null;
  }
  const found = findUpward(DEV_AGENT_BUNDLE_RELATIVE_PATH);
  return found ? { repoRoot: found.rootDir, localBundlePath: found.path } : null;
}

async function computeDevelopmentAgentAssetsSha256(params: {
  localBundlePath: string;
  repoRoot: string;
}): Promise<string> {
  const hash = createHash("sha256");
  hash.update("bundle:cf.cjs\n");
  hash.update(await readFile(params.localBundlePath));
  for (const packageName of REMOTE_AGENT_OFFICIAL_PLUGIN_PACKAGE_NAMES) {
    const packageRoot = join(params.repoRoot, "apps", "cf-cli", "packages", packageName);
    hash.update(`plugin:${packageName}\n`);
    await hashDevelopmentOfficialPluginPackage(hash, packageRoot, packageName);
  }
  const bundledSkillsRoot = join(params.repoRoot, "apps/cli/packages/bundled-skills");
  await assertDevelopmentOfficialPluginRequiredAssets(bundledSkillsRoot, "bundled-skills");
  await hashLocalPath(hash, bundledSkillsRoot, "bundled-skills");
  return hash.digest("hex");
}

async function hashDevelopmentOfficialPluginPackage(
  hash: ReturnType<typeof createHash>,
  packageRoot: string,
  packageName: string,
): Promise<void> {
  const manifestPath = join(packageRoot, ".cf-plugin", "plugin.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`[cf-agent-deploy] missing official plugin manifest: ${manifestPath}`);
  }
  await assertDevelopmentOfficialPluginRequiredAssets(packageRoot, packageName);

  for (const topLevelPath of REMOTE_AGENT_OFFICIAL_PLUGIN_INCLUDED_TOP_LEVEL_PATHS) {
    const sourcePath = join(packageRoot, topLevelPath);
    if (existsSync(sourcePath)) {
      await hashLocalPath(hash, sourcePath, `${packageName}/${topLevelPath}`);
    }
  }
}

async function hashLocalPath(
  hash: ReturnType<typeof createHash>,
  filePath: string,
  relativePath: string,
): Promise<void> {
  const fileStat = await lstat(filePath);
  if (fileStat.isDirectory()) {
    hash.update(`dir:${relativePath}\n`);
    const children = (await readdir(filePath)).sort((left, right) =>
      left.localeCompare(right, "en"),
    );
    for (const child of children) {
      await hashLocalPath(hash, join(filePath, child), `${relativePath}/${child}`);
    }
    return;
  }

  if (fileStat.isSymbolicLink()) {
    hash.update(`symlink:${relativePath}:${await readlink(filePath)}\n`);
    return;
  }

  if (!fileStat.isFile()) {
    return;
  }

  hash.update(`file:${relativePath}:${fileStat.mode & 0o777}:${fileStat.size}\n`);
  hash.update(await readFile(filePath));
}

async function assertDevelopmentOfficialPluginRequiredAssets(
  packageRoot: string,
  packageName: string,
): Promise<void> {
  const packagePrefix = `${packageName}/`;
  for (const requiredRelativePath of REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS) {
    if (!requiredRelativePath.startsWith(packagePrefix)) continue;
    const localRelativePath = requiredRelativePath.slice(packagePrefix.length);
    const requiredPath = join(packageRoot, ...localRelativePath.split("/"));
    try {
      await access(requiredPath);
    } catch {
      throw new Error(
        `[cf-agent-deploy] missing official plugin required asset: ${requiredPath}`,
      );
    }
  }
}

async function findMissingRemoteOfficialPluginAssetPaths(params: {
  backend: IRemoteBackend;
  remoteProviderDir: string;
}): Promise<string[]> {
  const missingPaths: string[] = [];
  for (const remotePath of buildRemoteAgentOfficialPluginRequiredPaths(params.remoteProviderDir)) {
    if (!(await params.backend.exists(remotePath))) {
      missingPaths.push(remotePath);
    }
  }
  return missingPaths;
}

async function shouldSkipDevelopmentCfAgentDeploy(params: {
  backend: IRemoteBackend;
  remoteVersionFile: string;
  remoteDevVersionFile: string;
  remoteBinaryPath: string;
  remoteBundlePath: string;
  runtimeResourceDir: string;
  runtimeVersion: string;
  devVersion: string;
  localBundleSha256: string;
  force: boolean;
  missingOfficialPluginAssetPaths: string[];
  loggers: DeployLoggers;
}): Promise<boolean> {
  if (params.force) {
    return false;
  }

  let remoteVersion: string;
  let remoteDevVersion: string;
  try {
    remoteVersion = (await params.backend.readFile(params.remoteVersionFile)).trim();
    remoteDevVersion = (await params.backend.readFile(params.remoteDevVersionFile)).trim();
  } catch {
    return false;
  }

  if (remoteVersion !== params.runtimeVersion || remoteDevVersion !== params.devVersion) {
    return false;
  }

  if (!(await params.backend.exists(params.remoteBinaryPath))) {
    return false;
  }

  if (isWslBackend(params.backend)) {
    try {
      const remoteWrapper = await params.backend.readFile(params.remoteBinaryPath);
      if (!isRemoteAgentBundleWrapperCurrent(remoteWrapper, params.runtimeResourceDir)) {
        return false;
      }
    } catch {
      return false;
    }
  }

  if (!(await params.backend.exists(params.remoteBundlePath))) {
    return false;
  }

  if (params.missingOfficialPluginAssetPaths.length > 0) {
    return false;
  }

  const verifyBundleScript =
    "require('node:fs/promises').readFile(process.argv[1]).then(content => {" +
    "process.exitCode = require('node:crypto').createHash('sha256').update(content).digest('hex') === process.argv[2] ? 0 : 1;" +
    "}).catch(() => { process.exitCode = 1; });";
  try {
    await waitForClose(
      await params.backend.exec(
        `"\${CF_SERVER_RUNTIME_ROOT:-$HOME/.cf/server}/node" -e ${quotePosixShellArg(verifyBundleScript)} ${quotePosixPathArg(params.remoteBundlePath)} ${quotePosixShellArg(params.localBundleSha256)}`,
      ),
    );
  } catch {
    params.loggers.logWarn(
      `[cf-agent-deploy] ${CF_AGENT_PROVIDER}: 远端 bundle SHA 不匹配or无法校验，重New上传`,
    );
    return false;
  }

  params.loggers.log(`[cf-agent-deploy] ${CF_AGENT_PROVIDER}: 开发态 cf.cjs 未变化，Skip`);
  return true;
}

async function stageDevelopmentOfficialPluginPackages(params: {
  repoRoot: string;
  packagesDir: string;
}): Promise<void> {
  await mkdir(params.packagesDir, { recursive: true });
  for (const packageName of REMOTE_AGENT_OFFICIAL_PLUGIN_PACKAGE_NAMES) {
    const sourceRoot = join(params.repoRoot, "apps", "cf-cli", "packages", packageName);
    const manifestPath = join(sourceRoot, ".cf-plugin", "plugin.json");
    if (!existsSync(manifestPath)) {
      throw new Error(`[cf-agent-deploy] missing official plugin manifest: ${manifestPath}`);
    }
    await assertDevelopmentOfficialPluginRequiredAssets(sourceRoot, packageName);

    const targetRoot = join(params.packagesDir, packageName);
    await mkdir(targetRoot, { recursive: true });
    for (const topLevelPath of REMOTE_AGENT_OFFICIAL_PLUGIN_INCLUDED_TOP_LEVEL_PATHS) {
      const sourcePath = join(sourceRoot, topLevelPath);
      if (existsSync(sourcePath)) {
        await cp(sourcePath, join(targetRoot, topLevelPath), {
          recursive: true,
        });
      }
    }
  }
  const bundledSkillsRoot = join(params.repoRoot, "apps/cli/packages/bundled-skills");
  await assertDevelopmentOfficialPluginRequiredAssets(bundledSkillsRoot, "bundled-skills");
  await cp(bundledSkillsRoot, join(params.packagesDir, "bundled-skills"), { recursive: true });
}

async function uploadDevelopmentOfficialPluginPackages(params: {
  backend: IRemoteBackend;
  repoRoot: string;
  remoteProviderDir: string;
  loggers: DeployLoggers;
}): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), "cf-remote-agent-packages-"));
  const packagesDir = join(tempDir, REMOTE_AGENT_OFFICIAL_PLUGIN_DIR_NAME);
  const archivePath = join(tempDir, `${REMOTE_AGENT_OFFICIAL_PLUGIN_DIR_NAME}.tar.gz`);
  try {
    await stageDevelopmentOfficialPluginPackages({
      repoRoot: params.repoRoot,
      packagesDir,
    });
    await createTarGzArchive(archivePath, [
      {
        sourcePath: packagesDir,
        archivePath: REMOTE_AGENT_OFFICIAL_PLUGIN_DIR_NAME,
      },
    ]);

    const ownerSuffix = `${Date.now()}-${randomUUID()}`;
    const remoteArchivePath = `${params.remoteProviderDir}/${REMOTE_AGENT_OFFICIAL_PLUGIN_DIR_NAME}.tar.gz-${ownerSuffix}`;
    const remoteExtractDir = `${params.remoteProviderDir}/${REMOTE_AGENT_OFFICIAL_PLUGIN_DIR_NAME}.extract-${ownerSuffix}`;
    const extractedPackagesDir = `${remoteExtractDir}/${REMOTE_AGENT_OFFICIAL_PLUGIN_DIR_NAME}`;
    const cleanupRemoteStaging = async (): Promise<void> => {
      try {
        const cleanupStream = await params.backend.exec(
          `rm -f ${quotePosixPathArg(remoteArchivePath)} && rm -rf ${quotePosixPathArg(remoteExtractDir)}`,
        );
        await waitForClose(cleanupStream);
      } catch (error) {
        params.loggers.logWarn(
          `[cf-agent-deploy] ${CF_AGENT_PROVIDER}: 清理 owner staging Failed (${ownerSuffix}): ${String(error)}`,
        );
      }
    };
    params.loggers.log(`[cf-agent-deploy] ${CF_AGENT_PROVIDER}: 开发态上传OfficialPlugins资源`);
    try {
      await params.backend.upload(archivePath, remoteArchivePath);
      await repairLegacyRemoteOfficialPluginDirectoryPermissions({
        backend: params.backend,
        loggers: params.loggers,
        remoteOfficialPluginDir: buildRemoteAgentOfficialPluginDir(params.remoteProviderDir),
      });
      const stream = await params.backend.exec(
        [
          "set -eu",
          `cleanup_staging() { rm -f ${quotePosixPathArg(remoteArchivePath)}; rm -rf ${quotePosixPathArg(remoteExtractDir)}; }`,
          "trap cleanup_staging EXIT HUP INT TERM",
          `rm -rf ${quotePosixPathArg(remoteExtractDir)}`,
          `mkdir -p ${quotePosixPathArg(remoteExtractDir)} ${quotePosixPathArg(params.remoteProviderDir)}`,
          `tar -xzf ${quotePosixPathArg(remoteArchivePath)} -C ${quotePosixPathArg(remoteExtractDir)}`,
          `test -d ${quotePosixPathArg(extractedPackagesDir)}`,
          `rm -rf ${quotePosixPathArg(`${params.remoteProviderDir}/${REMOTE_AGENT_OFFICIAL_PLUGIN_DIR_NAME}`)}`,
          buildRemoteMoveCommand(
            extractedPackagesDir,
            `${params.remoteProviderDir}/${REMOTE_AGENT_OFFICIAL_PLUGIN_DIR_NAME}`,
          ),
          "cleanup_staging",
          "trap - EXIT HUP INT TERM",
        ].join("\n"),
      );
      await waitForClose(stream);
    } catch (error) {
      await cleanupRemoteStaging();
      throw error;
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function deployDevelopmentCfAgentRuntime(
  backend: IRemoteBackend,
  params: DeployDevelopmentCfAgentRuntimeParams,
  loggers: DeployLoggers,
): Promise<boolean> {
  const developmentBundle = resolveDevelopmentAgentBundle();
  if (!developmentBundle) {
    return false;
  }

  const remoteBundlePath = `${params.remoteProviderDir}/${REMOTE_DEV_AGENT_BUNDLE_NAME}`;
  const remoteDevVersionFile = `${params.remoteProviderDir}/${REMOTE_DEV_AGENT_VERSION_FILE_NAME}`;
  const devVersion = await computeDevelopmentAgentAssetsSha256({
    localBundlePath: developmentBundle.localBundlePath,
    repoRoot: developmentBundle.repoRoot,
  });
  const missingOfficialPluginAssetPaths = await findMissingRemoteOfficialPluginAssetPaths({
    backend,
    remoteProviderDir: params.remoteProviderDir,
  });

  if (
    await shouldSkipDevelopmentCfAgentDeploy({
      backend,
      remoteVersionFile: params.remoteVersionFile,
      remoteDevVersionFile,
      remoteBinaryPath: params.remoteBinaryPath,
      remoteBundlePath,
      runtimeResourceDir: params.runtimeResourceDir,
      runtimeVersion: params.runtimeVersion,
      devVersion,
      localBundleSha256: createHash("sha256")
        .update(await readFile(developmentBundle.localBundlePath))
        .digest("hex"),
      force: params.force,
      missingOfficialPluginAssetPaths,
      loggers,
    })
  ) {
    return true;
  }

  loggers.log(
    `[cf-agent-deploy] ${CF_AGENT_PROVIDER}: 开发态上传Local cf.cjs ${devVersion.slice(0, 12)}`,
  );
  const mkdirStream = await backend.exec(`mkdir -p ${quotePosixPathArg(params.remoteProviderDir)}`);
  await waitForClose(mkdirStream);

  const remoteBundleTempPath = `${remoteBundlePath}.new`;
  await backend.upload(developmentBundle.localBundlePath, remoteBundleTempPath);
  const bundleStream = await backend.exec(
    buildRemoteMoveCommand(remoteBundleTempPath, remoteBundlePath),
  );
  await waitForClose(bundleStream);
  await uploadDevelopmentOfficialPluginPackages({
    backend,
    repoRoot: developmentBundle.repoRoot,
    remoteProviderDir: params.remoteProviderDir,
    loggers,
  });

  const wrapperContent = buildRemoteAgentBundleWrapper(params.runtimeResourceDir);
  const markerCommands = [
    buildWriteLiteralFileCommand(remoteDevVersionFile, devVersion),
    buildWriteLiteralFileCommand(params.remoteVersionFile, params.runtimeVersion),
  ];
  let markerStream;
  if (isWslBackend(backend)) {
    await deployRemoteAgentWrapper({
      backend,
      content: wrapperContent,
      remoteWrapperPath: params.remoteBinaryPath,
    });
    markerStream = await backend.exec(markerCommands.join(" && "));
  } else {
    const remoteWrapperTempPath = `${params.remoteBinaryPath}.new`;
    markerStream = await backend.exec(
      [
        buildWriteLiteralFileCommand(remoteWrapperTempPath, wrapperContent),
        buildRemoteExecutableReplaceCommand(remoteWrapperTempPath, params.remoteBinaryPath),
        ...markerCommands,
      ].join(" && "),
    );
  }
  await waitForClose(markerStream);
  loggers.log(
    `[cf-agent-deploy] ${CF_AGENT_PROVIDER}: 开发态部署Completed ${devVersion.slice(0, 12)}`,
  );
  return true;
}
