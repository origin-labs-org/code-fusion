/* eslint-disable max-lines -- Electron Builder config keeps related packaging hooks together so build order stays explicit. */
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { HELPER_APP_NAME } from "@origin-ai/cf-cua/broker/helperConstants";
import { runCommand, runCommandAndReadStdout } from "../../scripts/spawn-command.mjs";
import { loadBuiltinProviderConfig } from "../../scripts/builtin-provider-config.mjs";
import { noticesFileName, stageElectronNotices } from "../../scripts/third-party-notices.mjs";
import { resolveNativeSearchReleasePlan } from "../../scripts/native-search-tools-config.mjs";
import { getBuildMetadata } from "./scripts/build-metadata.mjs";
import { collectRuntimeModuleClosureEntries } from "./scripts/runtime-dependency-closure.mjs";
import {
  resolvePackagedNodePtyPrebuildPath,
  restoreTargetNodePtyPrebuild,
} from "./scripts/node-pty-package-assets.mjs";
import { cleanupPackagedSourcemaps } from "./scripts/packaged-sourcemap-cleanup.mjs";
import { getTargetPlatform } from "./scripts/target-platform.mjs";
import {
  resolveDesktopArtifactSuffix,
  resolveDesktopProductIdentity,
} from "./scripts/desktop-product-identity.mjs";
import { createWindowsPowerShellSecurityArgs } from "./scripts/powershell-command.mjs";
import { isSharpRequiredByComputerUse, verifyStagedSharp } from "./scripts/sharp-package-assets.mjs";
import { isRealComputerUseProducerInstalled } from "./scripts/computer-use-producer.mjs";
import { verifyStagedKoffi } from "./scripts/koffi-package-assets.mjs";
import {
  finalizePackagedWindowsCuaHelper,
  resolveElectronBuilderWindowsTarget,
} from "./scripts/windows-cua-helper-assets.mjs";
import {
  findDesktopNativePackageViolations,
  createDesktopNativePackagePrunePatterns,
  parseAsarListWithPackState,
} from "./scripts/desktop-native-package-policy.mjs";
import { replaceAppAsarFromStaging } from "./scripts/app-asar-repack.mjs";
import {
  patchNsisInstallSectionFile,
  restoreNsisInstallSectionFileSync,
} from "./scripts/patch-nsis-install-section.mjs";

const buildMetadata = getBuildMetadata();
const targetPlatform = getTargetPlatform();
const shouldPackageWindowsBrowserImportHelper =
  targetPlatform.os === "win32" && process.env.CF_ENABLE_WINDOWS_BROWSER_IMPORT === "1";
const builtinProviderConfig = await loadBuiltinProviderConfig();
const desktopProductIdentity = resolveDesktopProductIdentity({
  ...process.env,
  CF_ENV: builtinProviderConfig.environment,
});
const nativeSearchReleasePlan = resolveNativeSearchReleasePlan({
  platform: targetPlatform.os,
  arch: targetPlatform.arch,
});
const rawMacSigningIdentity = process.env.APPLE_SIGNING_IDENTITY || process.env.CSC_NAME;
const macSigningIdentity =
  rawMacSigningIdentity?.replace(/^Developer ID Application:\s*/, "") ?? null;
const shouldEnableMacSigning =
  process.env.CF_ENABLE_MAC_SIGN === "1" && Boolean(macSigningIdentity);
const workspaceRoot = resolve(import.meta.dirname, "../..");
const desktopPackageRoot = import.meta.dirname;
const shouldPackageComputerUseHelper = isRealComputerUseProducerInstalled({ desktopPackageRoot });
const HELPER_FILENAME = "cf-browser-import-helper.exe";
const runtimeModuleLookupRoots = [
  desktopPackageRoot,
  workspaceRoot,
  resolve(desktopPackageRoot, "node_modules", ".pnpm", "node_modules"),
  resolve(workspaceRoot, "node_modules", ".pnpm", "node_modules"),
];
const desktopDistDir = process.env.CF_DESKTOP_DIST_DIR || "dist";
const bundledCuaHelperSource = resolve(
  desktopPackageRoot,
  "bundled-cua-helper",
  targetPlatform.arch,
  HELPER_APP_NAME,
);
const DEFAULT_ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/";
const requireFromConfig = createRequire(import.meta.url);
let nsisInstallSectionPatched = false;
let nsisInstallSectionOriginalSource = null;
let nsisInstallSectionPath = null;
const desktopElectronVersion = requireFromConfig("./package.json").devDependencies.electron;
const asarCliPath = resolve(
  dirname(requireFromConfig.resolve("@electron/asar/package.json")),
  "bin",
  "asar.js",
);
const REQUIRED_ASAR_RUNTIME_MODULES = [
  "module-details-from-path",
  "@opentelemetry/api-logs",
  "@opentelemetry/sdk-metrics",
  "!**/*.pdb",
  "!**/__tests__/**",
  "!**/test/**",
  "!**/tests/**",
  "!**/example/**",
  "!**/examples/**",
  "!**/README*",
  "!**/CHANGELOG*",
  "!**/CONTRIBUTING*",
  "!**/CODE_OF_CONDUCT*",
  "!**/SECURITY*",
];

function buildDesktopArtifactName(platformName, extension = "${ext}") {
  return `\${productName}-\${version}-${platformName}-\${arch}${desktopArtifactEnvSuffix}.${extension}`;
}

function runAsarCommand(args) {
  runCommand(process.execPath, [asarCliPath, ...args], {
    cwd: import.meta.dirname,
    env: process.env,
  });
}

function runAsarCommandAndReadStdout(args) {
  return runCommandAndReadStdout(process.execPath, [asarCliPath, ...args], {
    cwd: import.meta.dirname,
    env: process.env,
    maxBuffer: commandStdoutMaxBuffer,
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function runTimedSync(label, fn) {
  const startMs = Date.now();
  console.log(`[ci][timer] ${label} start`);
  try {
    return fn();
  } finally {
    console.log(`[ci][timer] ${label} end duration_ms=${Date.now() - startMs}`);
  }
}

async function runTimedAsync(label, fn) {
  const startMs = Date.now();
  console.log(`[ci][timer] ${label} start`);
  try {
    return await fn();
  } finally {
    console.log(`[ci][timer] ${label} end duration_ms=${Date.now() - startMs}`);
  }
}

function resolveAppAsarPath(context) {
  if (context.electronPlatformName === "darwin") {
    const appName = `${context.packager?.appInfo?.productFilename ?? "CodeFusion"}.app`;
    return resolve(context.appOutDir, appName, "Contents", "Resources", "app.asar");
  }

  return resolve(context.appOutDir, "resources", "app.asar");
}

function resolvePackagedResourcesDir(context) {
  if (context.electronPlatformName === "darwin") {
    const appName = `${context.packager?.appInfo?.productFilename ?? "CodeFusion"}.app`;
    return resolve(context.appOutDir, appName, "Contents", "Resources");
  }

  return resolve(context.appOutDir, "resources");
}

function normalizeAsarEntry(entry) {
  return entry.trim().replaceAll("\\", "/");
}

function resolveMissingRuntimeModules(appAsarPath) {
  const asarEntries = runAsarCommandAndReadStdout(["list", appAsarPath])
    .split("\n")
    .map(normalizeAsarEntry)
    .filter(Boolean);
  const asarEntrySet = new Set(asarEntries);

  const runtimeModules = collectRuntimeModuleClosureEntries(
    REQUIRED_ASAR_RUNTIME_MODULES,
    runtimeModuleLookupRoots,
  );
  const resolvableRuntimeModules = runtimeModules.filter((entry) => {
    if (!entry.sourceModulePath) {
      console.warn(
        `[afterPack] runtime module not found, skip injection: ${entry.moduleName}; searched=${runtimeModuleLookupRoots
          .map((lookupRoot) => resolve(lookupRoot, "node_modules", entry.moduleName))
          .join(", ")}`,
      );
      return false;
    }
    return true;
  });
  return resolvableRuntimeModules.filter((entry) => {
    const { moduleName } = entry;
    const moduleRoot = `/node_modules/${moduleName}`;
    if (asarEntrySet.has(moduleRoot)) {
      return false;
    }
    for (const entry of asarEntrySet) {
      if (entry.startsWith(`${moduleRoot}/`)) {
        return false;
      }
    }
    return true;
  });
}

async function injectHoistedRuntimeModulesIntoAsar(context) {
  const appAsarPath = resolveAppAsarPath(context);
  if (!existsSync(appAsarPath)) {
    throw new Error(`打包产物Missing app.asar: ${appAsarPath}`);
  }

  const missingRuntimeModules = runTimedSync("afterPack:scan-missing-runtime-modules", () =>
    resolveMissingRuntimeModules(appAsarPath),
  );
  if (missingRuntimeModules.length === 0) {
    console.log("[afterPack] runtime modules already complete, skip app.asar rewrite");
    return;
  }
  console.log(`[afterPack] missing runtime modules count=${missingRuntimeModules.length}`);

  mkdirSync(tmpdir(), { recursive: true });
  const stagingDir = mkdtempSync(resolve(tmpdir(), "cf-app-asar-"));
  try {
    runTimedSync("afterPack:asar-extract", () =>
      runAsarCommand(["extract", appAsarPath, stagingDir]),
    );

    const stagingNodeModulesDir = resolve(stagingDir, "node_modules");
    mkdirSync(stagingNodeModulesDir, { recursive: true });

    runTimedSync("afterPack:copy-runtime-modules", () => {
      for (const runtimeModule of missingRuntimeModules) {
        const { moduleName, sourceModulePath } = runtimeModule;
        const targetModulePath = resolve(stagingNodeModulesDir, moduleName);

        if (!sourceModulePath) {
          throw new Error(
            `未找到Run时依赖 ${moduleName}，已Search: ${runtimeModuleLookupRoots
              .map((lookupRoot) => resolve(lookupRoot, "node_modules", moduleName))
              .join(", ")}`,
          );
        }

        mkdirSync(dirname(targetModulePath), { recursive: true });
        rmSync(targetModulePath, { force: true, recursive: true });
        cpSync(sourceModulePath, targetModulePath, { recursive: true });
      }
    });

    await runTimedAsync("afterPack:asar-pack", () =>
      replaceAppAsarFromStaging({
        sourceDir: stagingDir,
        appAsarPath,
        targetPlatformKey: targetPlatform.key,
        runAsarCommand,
      }),
    );
  } finally {
    rmSync(stagingDir, { force: true, recursive: true });
  }
}

async function stripPackagedSourcemapReferences(context) {
  await cleanupPackagedSourcemaps({
    appAsarPath: resolveAppAsarPath(context),
    resourcesDir: resolvePackagedResourcesDir(context),
    runAsarCommand,
    runTimedSync,
    runTimedAsync,
    replaceAppAsarFromStaging: ({ sourceDir, appAsarPath }) =>
      replaceAppAsarFromStaging({
        sourceDir,
        appAsarPath,
        targetPlatformKey: targetPlatform.key,
        runAsarCommand,
      }),
  });
}

function assertPackagedNativeResourcePolicy(context) {
  const appAsarPath = resolveAppAsarPath(context);
  const entries = parseAsarListWithPackState(
    runAsarCommandAndReadStdout(["list", "--is-pack", appAsarPath]),
  );
  const violations = findDesktopNativePackageViolations(entries, targetPlatform.key);
  if (violations.length > 0) {
    throw new Error(`Desktop native 资源Boundaries校验Failed:\n- ${violations.join("\n- ")}`);
  }
}

function assertPackagedNodePtyPrebuild(context) {
  const targetBinaryPath = resolvePackagedNodePtyPrebuildPath({
    resourcesDir: resolvePackagedResourcesDir(context),
    platformKey: targetPlatform.key,
  });
  if (!existsSync(targetBinaryPath))
    throw new Error(`node-pty 预编译产物缺失: ${targetBinaryPath}`);
}

function assertPackagedCuaSharp(context) {
  if (!isSharpRequiredByComputerUse({ desktopPackageRoot })) return;
  const problems = [
    [
      "packages/browser-use-plugin",
      verifyStagedSharp({
        resourcesDir: resolvePackagedResourcesDir(context),
        targetPlatform,
        pluginRelativePath: "packages/browser-use-plugin",
      }),
    ],
    [
      "packages/cf-cua-plugin",
      verifyStagedSharp({
        resourcesDir: resolvePackagedResourcesDir(context),
        targetPlatform,
        pluginRelativePath: "packages/cf-cua-plugin",
      }),
    ],
  ].flatMap(([pluginPath, pluginProblems]) =>
    pluginProblems.map((problem) => `${pluginPath}: ${problem}`),
  );
  if (problems.length > 0) {
    throw new Error(
      `node_repl sharp runtime is incomplete in the packaged app:\n- ${problems.join("\n- ")}`,
    );
  }
}

function assertPackagedCuaKoffi(context) {
  const problems = verifyStagedKoffi({
    resourcesDir: resolvePackagedResourcesDir(context),
    targetPlatform,
  });
  if (problems.length > 0) {
    throw new Error(
      `CUA plugin koffi runtime is incomplete in the packaged app:\n- ${problems.join("\n- ")}`,
    );
  }
}

function assertSignedWindowsBrowserImportHelper(context) {
  if (
    !shouldPackageWindowsBrowserImportHelper ||
    context.electronPlatformName !== "win32" ||
    !shouldEnableWindowsVsign
  )
    return;
  const helperPath = resolve(context.appOutDir, "resources", "browser-import", HELPER_FILENAME);
  const appExecutablePath = resolve(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.exe`,
  );
  const script = [
    "$helper=Microsoft.PowerShell.Security\\Get-AuthenticodeSignature -LiteralPath $cfArg0;",
    "$app=Microsoft.PowerShell.Security\\Get-AuthenticodeSignature -LiteralPath $cfArg1;",
    "if($helper.Status -ne 'Valid' -or $app.Status -ne 'Valid'){",
    "[Console]::Error.WriteLine(('Authenticode status invalid: helper={0} ({1}); app={2} ({3})' -f $helper.Status,$helper.StatusMessage,$app.Status,$app.StatusMessage));",
    "exit 23};",
    "if($null -eq $helper.SignerCertificate -or $null -eq $app.SignerCertificate){",
    "[Console]::Error.WriteLine('Authenticode signer certificate missing');exit 24};",
    "if($helper.SignerCertificate.Thumbprint -ne $app.SignerCertificate.Thumbprint){",
    "[Console]::Error.WriteLine(('Authenticode signer mismatch: helper={0}; app={1}' -f $helper.SignerCertificate.Thumbprint,$app.SignerCertificate.Thumbprint));",
    "exit 25};",
  ].join("");
  runCommand(
    "powershell.exe",
    createWindowsPowerShellSecurityArgs(script, [helperPath, appExecutablePath]),
  );
}

function signWindowsBrowserImportHelper(context) {
  if (
    !shouldPackageWindowsBrowserImportHelper ||
    context.electronPlatformName !== "win32" ||
    !shouldEnableWindowsVsign
  )
    return;
  const helperPath = resolve(context.appOutDir, "resources", "browser-import", HELPER_FILENAME);
  runCommand("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    resolve(workspaceRoot, "scripts/sign-windows.ps1"),
    "-FilePath",
    helperPath,
  ]);
}

/** @type {import("electron-builder").Configuration} */
export default {
  appId: desktopProductIdentity.appId,
  extraMetadata: {
    version: buildMetadata.appVersion,
    cfProductFlavor: desktopProductIdentity.flavor,
    homepage: "https://cf.z.ai",
    author: {
      name: "CodeFusion",
      email: "dev@cf.z.ai",
    },
  },
  electronLanguages: ["en-US", "zh-CN"],
  electronVersion: "41.0.3",
  ...(targetPlatform.os === "win32"
    ? { electronFuses: { enableNodeCliInspectArguments: false } }
    : {}),
  electronDownload: {
    mirror: resolveElectronDownloadMirror(),
  },
  productName: desktopProductIdentity.productName,
  directories: {
    output: desktopDistDir,
    buildResources: "build",
  },
  files: [
    "out/**/*",
    "package.json",
    ...PACKAGING_PRUNE_PATTERNS,
    ...createDesktopNativePackagePrunePatterns(targetPlatform.key),
    "!node_modules/@origin-ai/cf-**",
    "!node_modules/react*", "!node_modules{,/**/*}"],
          },
          {
            from: `bundled-tools/${targetPlatform.key}/cua-helper/node_modules`,
            to: "tools/cua-helper/node_modules",
            filter: ["**/*", "!**/*.map"],
          },
        ]
      : []),
    {
      from: `bundled-agents/${targetPlatform.key}/glm`,
      to: "glm",
      filter: ["**/*", "!**/*.map"],
    },
    {
      from: `bundled-tools/${targetPlatform.key}/ripgrep`,
      to: "tools/ripgrep",
      filter: ["**/*"],
    },
    ...nativeSearchReleasePlan.extraResourceToolIds.map((toolId) => ({
      from: `bundled-tools/${targetPlatform.key}/${toolId}`,
      to: `tools/${toolId}`,
      filter: ["**/*"],
    })),
  ],
  npmRebuild: false,
  protocols: [
    {
      name: desktopProductIdentity.productName,
      schemes: ["cf"],
    },
  ],
  mac: {
    target: ["dmg", "zip"],
    category: "public.app-category.developer-tools",
    artifactName: buildDesktopArtifactName("mac"),
    extendInfo: {
      NSAppleEventsUsageDescription: `${desktopProductIdentity.productName} needs Apple Events access to coordinate local automation workflows with user-approved desktop apps.`,
      NSBluetoothAlwaysUsageDescription: `${desktopProductIdentity.productName} needs Bluetooth access to list nearby devices when a website you open in the embedded browser requests one.`,
    },
    identity: shouldEnableMacSigning ? macSigningIdentity : null,
    notarize: false,
    hardenedRuntime: shouldEnableMacSigning,
    gatekeeperAssess: false,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.inherit.plist",
    signIgnore: [
      "[/\\\\]Contents[/\\\\]Resources[/\\\\]cua-helper([/\\\\]|$)",
      "[/\\\\]Contents[/\\\\]Resources[/\\\\]glm([/\\\\]|$)",
      "[/\\\\]Contents[/\\\\]Resources[/\\\\]tools([/\\\\]|$)",
    ],
  },
  win: {
    target: ["nsis"],
    artifactName: buildDesktopArtifactName("win"),
    signExts: [".node", ".dll"],
    ...(shouldEnableWindowsVsign
      ? {
          signtoolOptions: {
            sign: "./scripts/sign-windows-hook.cjs",
          },
        }
      : {}),
  },
  linux: {
    target: ["AppImage", "deb", "rpm", "pacman"],
    artifactName: buildDesktopArtifactName("linux"),
    executableName: desktopProductIdentity.linuxExecutableName,
    category: "Development",
    maintainer: "CodeFusion <dev@cf.z.ai>",
  },
  deb: {
    packageName: desktopProductIdentity.linuxPackageName,
  },
  pacman: {
    packageName: desktopProductIdentity.linuxPackageName,
    depends: PACMAN_RUNTIME_DEPENDENCIES,
    artifactName: buildDesktopArtifactName("linux", "pkg.tar.zst"),
  },
  rpm: {
    packageName: desktopProductIdentity.linuxPackageName,
    fpm: ["-d", "mesa-libgbm", "-d", "alsa-lib"],
  },
  dmg: {
    size: "3200m",
    background: "build/dmg_background.png",
    icon: "build/icon_installer.icns",
    contents: [
      { x: 640, y: 56, type: "file", path: ".background.tiff" },
      { x: 640, y: 56, type: "file", path: ".VolumeIcon.icns" },
      { x: 130, y: 220 },
      { x: 410, y: 220, type: "link", path: "/Applications" },
    ],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: "build/icon_installer.ico",
    uninstallerIcon: "build/icon_installer.ico",
    installerHeaderIcon: "build/icon_installer.ico",
  },
  detectUpdateChannel: false,
  publish: {
    provider: "generic",
    useMultipleRangeRequest: false,
    url: "http://localhost:8081",
  },
};
