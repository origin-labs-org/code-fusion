#!/usr/bin/env node

/* eslint-disable max-lines */

import { spawn } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import process from "node:process";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { collectRuntimeModuleClosureEntries } from "./runtime-dependency-closure.mjs";
import { resolveDesktopProductIdentity } from "./desktop-product-identity.mjs";
import {
  findDesktopNativePackageViolations,
  parseAsarListWithPackState,
} from "./desktop-native-package-policy.mjs";
import {
  resolveSpawnRuntimeOptions,
  runCommand,
  runCommandAndReadStdout,
} from "../../../scripts/spawn-command.mjs";
import { resolveIntranetDepsBaseUrl } from "../../../scripts/intranetDefaults.mjs";

const desktopRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(desktopRoot, "../..");
const requireFromBundle = createRequire(import.meta.url);
const asarCliPath = resolve(
  dirname(requireFromBundle.resolve("@electron/asar/package.json")),
  "bin",
  "asar.js",
);
const runtimeModuleLookupRoots = [
  desktopRoot,
  workspaceRoot,
  resolve(desktopRoot, "node_modules", ".pnpm", "node_modules"),
  resolve(workspaceRoot, "node_modules", ".pnpm", "node_modules"),
];
const pnpmCommand = "pnpm";
const DEFAULT_TARGET_OS = "mac";
const DEFAULT_TARGET_ARCH = "arm64";
const desktopDistDir = process.env.CF_DESKTOP_DIST_DIR || "dist";
const desktopDistRoot = resolve(desktopRoot, desktopDistDir);
const desktopProductIdentity = resolveDesktopProductIdentity(process.env);

const osAliasMap = new Map([
  ["mac", "mac"],
  ["macos", "mac"],
  ["darwin", "mac"],
  ["osx", "mac"],
  ["win", "win"],
  ["windows", "win"],
  ["win32", "win"],
  ["linux", "linux"],
]);

const archAliasMap = new Map([
  ["x64", "x64"],
  ["amd64", "x64"],
  ["x86_64", "x64"],
  ["arm64", "arm64"],
  ["aarch64", "arm64"],
]);

const osBuilderFlagMap = {
  mac: "--mac",
  win: "--win",
  linux: "--linux",
};

const archBuilderFlagMap = {
  x64: "--x64",
  arm64: "--arm64",
};

const artifactExtensionsByOs = {
  mac: [".dmg", ".zip"],
  win: [".exe"],
  linux: [".AppImage", ".deb", ".rpm", ".pkg.tar.zst"],
};
const artifactArchHintsByArch = {
  x64: ["x64", "x86_64", "amd64"],
  arm64: ["arm64", "aarch64"],
};
const commandStdoutMaxBuffer = 64 * 1024 * 1024;
const requiredRuntimeModules = [
  "module-details-from-path",
  "pngjs",
  "@opentelemetry/sdk-metrics",
  "@opentelemetry/exporter-trace-otlp-proto",
  "@opentelemetry/exporter-metrics-otlp-proto",
  "@babel/runtime",
  "undici",
  "node-forge",
  "yauzl",
  "@larksuiteoapi/node-sdk",
  "asn1",
  "bcrypt-pbkdf",
  "tweetnacl",
];
const electronBuilderRetryCount = 3;
const electronBuilderRetryDelayMs = 5_000;
const electronBuilderHeartbeatIntervalMs = 30_000;
export const DEFAULT_ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/";
export const NPMMIRROR_ELECTRON_BUILDER_BINARIES_MIRROR =
  "https://registry.npmmirror.com/-/binary/electron-builder-binaries/";
export const OFFICIAL_ELECTRON_BUILDER_BINARIES_MIRROR =
  "https://github.com/electron-userland/electron-builder-binaries/releases/download/";

function isMisconfiguredNpmMirrorElectronRuntimeMirror(mirror) {
  return mirror
    .trim()
    .replace(/\/+$/, "")
    .toLowerCase()
    .includes("npmmirror.com/binaries/electron");
}

export function resolveElectronMirror(env = process.env) {
  const existingMirror =
    env.NPM_CONFIG_ELECTRON_MIRROR ||
    env.npm_config_electron_mirror ||
    env.npm_package_config_electron_mirror ||
    env.ELECTRON_MIRROR;
  if (existingMirror?.trim()) {
    return existingMirror.trim();
  }

  return DEFAULT_ELECTRON_MIRROR;
}

export function createElectronRuntimeMirrorEnv(mirror) {
  return {
    CF_ELECTRON_RUNTIME_MIRROR: mirror,
    ELECTRON_MIRROR: "",
    NPM_CONFIG_ELECTRON_MIRROR: "",
    npm_config_electron_mirror: "",
    npm_package_config_electron_mirror: "",
  };
}

function resolveDefaultElectronBuilderBinariesMirror(env = process.env) {
  try {
    return `${resolveIntranetDepsBaseUrl(env)}/electron-builder-binaries/`;
  } catch {
    return OFFICIAL_ELECTRON_BUILDER_BINARIES_MIRROR;
  }
}

export function resolveElectronBuilderBinariesMirror(env = process.env) {
  const existingMirror =
    env.NPM_CONFIG_ELECTRON_BUILDER_BINARIES_MIRROR ||
    env.npm_config_electron_builder_binaries_mirror ||
    env.npm_package_config_electron_builder_binaries_mirror ||
    env.ELECTRON_BUILDER_BINARIES_MIRROR;
  if (existingMirror?.trim()) {
    if (isMisconfiguredNpmMirrorElectronRuntimeMirror(existingMirror)) {
      return NPMMIRROR_ELECTRON_BUILDER_BINARIES_MIRROR;
    }

    return existingMirror.trim();
  }

  return resolveDefaultElectronBuilderBinariesMirror(env);
}

export function createElectronBuilderBinariesMirrorEnv(mirror) {
  return {
    ELECTRON_BUILDER_BINARIES_DOWNLOAD_OVERRIDE_URL: "",
    ELECTRON_BUILDER_BINARIES_MIRROR: mirror,
    NPM_CONFIG_ELECTRON_BUILDER_BINARIES_DOWNLOAD_OVERRIDE_URL: "",
    NPM_CONFIG_ELECTRON_BUILDER_BINARIES_MIRROR: mirror,
    npm_config_electron_builder_binaries_download_override_url: "",
    npm_config_electron_builder_binaries_mirror: mirror,
    npm_package_config_electron_builder_binaries_download_override_url: "",
    npm_package_config_electron_builder_binaries_mirror: mirror,
  };
}

export function shouldFallbackElectronBuilderBinariesMirror(output, mirror, env = process.env) {
  const normalizedOutput = output.toLowerCase();
  const normalizedMirror = mirror.trim().replace(/\/+$/, "");
  const normalizedDefaultMirror = resolveDefaultElectronBuilderBinariesMirror(env).replace(
    /\/+$/,
    "",
  );
  const isMissingBuilderBinary =
    normalizedOutput.includes("status code 404") || normalizedOutput.includes("response code 404");
  const isDefaultDepsMirrorMissing =
    normalizedMirror === normalizedDefaultMirror &&
    normalizedOutput.includes("electron-builder-binaries/");
  const isMisconfiguredNpmMirrorElectronRuntime =
    normalizedOutput.includes("npmmirror.com/binaries/electron/") &&
    !normalizedOutput.includes("electron-builder-binaries/");

  return (
    isMissingBuilderBinary &&
    (isDefaultDepsMirrorMissing || isMisconfiguredNpmMirrorElectronRuntime)
  );
}

export function resolveElectronBuilderBinariesFallbackMirror(output, mirror, env = process.env) {
  if (!shouldFallbackElectronBuilderBinariesMirror(output, mirror, env)) {
    return null;
  }

  return NPMMIRROR_ELECTRON_BUILDER_BINARIES_MIRROR;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function artifactNameMatchesArch(fileName, archHint) {
  return new RegExp(`-${escapeRegExp(archHint.toLowerCase())}(?:[._-])`, "i").test(fileName);
}

function printHelp() {
  console.log(`Desktop端打包脚本

用法:
  pnpm bundle:desktop
  pnpm bundle:desktop -- --os mac --arch x64
  pnpm bundle:desktop -- linux arm64

参Count:
  --os, -o <mac|win|linux>     Target操作System，Default mac
  --arch, -a <x64|arm64>       Target CPU 架构，Default arm64
  --skip-prepare               Skip prepare:runtime-assets
  --skip-build                 Skip pnpm build
  --dry-run                    只打印FinalCommand，不execute打包
  -h, --help                   ViewHelp

环Context变量:
  CF_TARGET_OS              与 --os 等价
  CF_TARGET_ARCH            与 --arch 等价
`);
}

function normalizeOs(rawOs) {
  const normalizedOs = osAliasMap.get(rawOs.toLowerCase());
  if (!normalizedOs) {
    throw new Error(`不支持的Target操作System: ${rawOs}`);
  }
  return normalizedOs;
}

function normalizeArch(rawArch) {
  const normalizedArch = archAliasMap.get(rawArch.toLowerCase());
  if (!normalizedArch) {
    throw new Error(`不支持的Target CPU 架构: ${rawArch}`);
  }
  return normalizedArch;
}

function parseArgs(argv) {
  const options = {
    os: process.env.CF_TARGET_OS ?? null,
    arch: process.env.CF_TARGET_ARCH ?? null,
    skipPrepare: process.env.CF_SKIP_PREPARE === "1",
    skipBuild: process.env.CF_SKIP_BUILD === "1",
    dryRun: false,
    positionals: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--skip-prepare") {
      options.skipPrepare = true;
      continue;
    }

    if (arg === "--skip-build") {
      options.skipBuild = true;
      continue;
    }

    if (arg === "-o" || arg === "--os") {
      options.os = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg.startsWith("--os=")) {
      options.os = arg.slice("--os=".length);
      continue;
    }

    if (arg === "-a" || arg === "--arch") {
      options.arch = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg.startsWith("--arch=")) {
      options.arch = arg.slice("--arch=".length);
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`不支持的参Count: ${arg}`);
    }

    options.positionals.push(arg);
  }

  const positionalOs = options.positionals[0];
  const positionalArch = options.positionals[1];

  if (options.positionals.length > 2) {
    throw new Error(`参Count过多: ${options.positionals.join(" ")}`);
  }

  const resolvedOs = normalizeOs(options.os ?? positionalOs ?? DEFAULT_TARGET_OS);
  const resolvedArch = normalizeArch(options.arch ?? positionalArch ?? DEFAULT_TARGET_ARCH);

  return {
    os: resolvedOs,
    arch: resolvedArch,
    skipPrepare: options.skipPrepare,
    skipBuild: options.skipBuild,
    dryRun: options.dryRun,
  };
}

function run(command, args, envPatch = {}) {
  console.log(`[bundle] > ${command} ${args.join(" ")}`);

  runCommand(command, args, {
    cwd: desktopRoot,
    env: {
      ...process.env,
      ...envPatch,
    },
  });
}

function findBuiltArtifact(os, arch) {
  const distRoot = desktopDistRoot;
  const extensions = artifactExtensionsByOs[os] ?? [];
  const candidates = [];

  const archHints = artifactArchHintsByArch[arch] ?? [arch];

  for (const entry of readdirSync(distRoot, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    const fullPath = join(distRoot, entry.name);
    const lowerName = entry.name.toLowerCase();
    const matchesExtension = extensions.some((extension) =>
      lowerName.endsWith(extension.toLowerCase()),
    );
    const matchesArch = archHints.some((archHint) => artifactNameMatchesArch(lowerName, archHint));

    if (!matchesExtension || !matchesArch) {
      continue;
    }

    candidates.push({
      path: fullPath,
      mtimeMs: statSync(fullPath).mtimeMs,
    });
  }

  if (candidates.length === 0) {
    throw new Error(`未找到 ${os}/${arch} 的打包产物File，无法execute体积Audit`);
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0].path;
}
function runAndReadStdout(command, args) {
  return runCommandAndReadStdout(command, args, {
    cwd: desktopRoot,
    env: process.env,
    maxBuffer: commandStdoutMaxBuffer,
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
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

function shouldRetryElectronBuilderFailure(output) {
  const normalizedOutput = output.toLowerCase();
  const transientSignals = [
    "github.com/electron-userland/electron-builder-binaries/releases/download",
    "electron-builder-binaries/",
    "nsis-resources-",
    'get "https://',
    " eof",
    "read: connection reset by peer",
    "connection reset by peer",
    "connectex",
    "timed out",
    "timeout",
    "socket hang up",
    "unexpected end of file",
    "err_electron_builder_cannot_execute",
  ];

  return transientSignals.some((signal) => normalizedOutput.includes(signal));
}

async function runElectronBuilderWithRetry(args, envPatch) {
  const retryEnvPatch = { ...envPatch };
  let didFallbackElectronBuilderMirror = false;

  for (let attempt = 1; attempt <= electronBuilderRetryCount; attempt += 1) {
    console.log(
      `[bundle] > ${pnpmCommand} ${args.join(" ")} ${attempt > 1 ? `(retry ${attempt}/${electronBuilderRetryCount})` : ""}`.trim(),
    );

    const mergedEnv = {
      ...process.env,
      ...retryEnvPatch,
    };
    const result = await new Promise((resolvePromise) => {
      const child = spawn(pnpmCommand, args, {
        cwd: desktopRoot,
        env: mergedEnv,
        stdio: ["inherit", "pipe", "pipe"],
        ...resolveSpawnRuntimeOptions(pnpmCommand),
      });

      let outputBuffer = "";
      const startedAt = Date.now();
      let lastOutputAt = startedAt;
      const heartbeatTimer = setInterval(() => {
        const now = Date.now();
        console.log(
          `[bundle][heartbeat] electron-builder running elapsed_ms=${now - startedAt} idle_ms=${now - lastOutputAt}`,
        );
      }, electronBuilderHeartbeatIntervalMs);
      const appendOutput = (chunk, writeFn) => {
        const text = chunk.toString();
        outputBuffer += text;
        lastOutputAt = Date.now();
        writeFn(text);
      };

      child.stdout?.on("data", (chunk) =>
        appendOutput(chunk, (text) => process.stdout.write(text)),
      );
      child.stderr?.on("data", (chunk) =>
        appendOutput(chunk, (text) => process.stderr.write(text)),
      );

      child.on("error", (error) => {
        clearInterval(heartbeatTimer);
        resolvePromise({
          status: null,
          error,
          combinedOutput: `${outputBuffer}\n${error.message}`,
        });
      });

      child.on("close", (status) => {
        clearInterval(heartbeatTimer);
        resolvePromise({
          status,
          error: null,
          combinedOutput: outputBuffer,
        });
      });
    });

    if (!result.error && result.status === 0) {
      return;
    }

    const failureOutput = [
      result.combinedOutput,
      result.error?.message,
      typeof result.status === "number"
        ? `${pnpmCommand} ${args.join(" ")} failed with code ${result.status}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    const currentElectronBuilderMirror = retryEnvPatch.ELECTRON_BUILDER_BINARIES_MIRROR ?? "";
    const fallbackElectronBuilderMirror = resolveElectronBuilderBinariesFallbackMirror(
      failureOutput,
      currentElectronBuilderMirror,
      process.env,
    );
    if (
      attempt < electronBuilderRetryCount &&
      !didFallbackElectronBuilderMirror &&
      fallbackElectronBuilderMirror
    ) {
      Object.assign(
        retryEnvPatch,
        createElectronBuilderBinariesMirrorEnv(fallbackElectronBuilderMirror),
      );
      didFallbackElectronBuilderMirror = true;
      console.warn(
        `[bundle] electron-builder Two进制镜像Missing file，切换到 registry.npmmirror 后Retry (${attempt}/${electronBuilderRetryCount})`,
      );
      await sleep(electronBuilderRetryDelayMs);
      continue;
    }

    const shouldRetry =
      attempt < electronBuilderRetryCount && shouldRetryElectronBuilderFailure(failureOutput);
    if (!shouldRetry) {
      if (result.error) {
        throw result.error;
      }

      throw new Error(
        `${pnpmCommand} ${args.join(" ")} failed with code ${result.status ?? "unknown"}`,
      );
    }

    console.warn(
      `[bundle] electron-builder 下载资源Failed，${electronBuilderRetryDelayMs}ms 后Retry (${attempt}/${electronBuilderRetryCount})`,
    );
    await sleep(electronBuilderRetryDelayMs);
  }
}

function resolveAppAsarPath(os, arch) {
  if (os === "mac") {
    return resolve(
      desktopRoot,
      desktopDistDir,
      arch === "arm64" ? "mac-arm64" : "mac",
      `${desktopProductIdentity.productName}.app`,
      "Contents",
      "Resources",
      "app.asar",
    );
  }

  if (os === "win") {
    return resolve(
      desktopRoot,
      desktopDistDir,
      arch === "arm64" ? "win-arm64-unpacked" : "win-unpacked",
      "resources",
      "app.asar",
    );
  }

  if (os === "linux") {
    return resolve(
      desktopRoot,
      desktopDistDir,
      arch === "arm64" ? "linux-arm64-unpacked" : "linux-unpacked",
      "resources",
      "app.asar",
    );
  }

  throw new Error(`不支持的Target操作System: ${os}`);
}

function verifyPackagedRuntimeDependencies(os, arch) {
  const appAsarPath = resolveAppAsarPath(os, arch);
  if (!existsSync(appAsarPath)) {
    throw new Error(`打包产物Missing app.asar: ${appAsarPath}`);
  }

  const asarEntriesWithPackState = parseAsarListWithPackState(
    runAndReadStdout(process.execPath, [asarCliPath, "list", "--is-pack", appAsarPath]),
  );
  const asarEntries = asarEntriesWithPackState.map((entry) => entry.path);

  const targetPlatformKey = `${os === "mac" ? "darwin" : os === "win" ? "win32" : os}-${arch}`;
  const nativePackageViolations = findDesktopNativePackageViolations(
    asarEntriesWithPackState,
    targetPlatformKey,
  );
  if (nativePackageViolations.length > 0) {
    throw new Error(`打包产物包含越Boundary native 资源:\n- ${nativePackageViolations.join("\n- ")}`);
  }

  const runtimeModules = collectRuntimeModuleClosureEntries(
    requiredRuntimeModules,
    runtimeModuleLookupRoots,
  );
  const resolvableRuntimeModules = runtimeModules.filter((entry) => {
    if (!entry.sourceModulePath) {
      console.warn(
        `[bundle] runtime module not found in workspace, skip verify: ${entry.moduleName}; searched=${runtimeModuleLookupRoots
          .map((lookupRoot) => resolve(lookupRoot, "node_modules", entry.moduleName))
          .join(", ")}`,
      );
      return false;
    }
    return true;
  });

  for (const { moduleName } of resolvableRuntimeModules) {
    const moduleRoot = `/node_modules/${moduleName}`;
    const hasModule = asarEntries.some(
      (entry) => entry === moduleRoot || entry.startsWith(`${moduleRoot}/`),
    );

    if (!hasModule) {
      throw new Error(`打包产物MissingRun时依赖 ${moduleName}: ${appAsarPath}`);
    }
  }
}

async function main() {
  const { os, arch, skipPrepare, skipBuild, dryRun } = parseArgs(process.argv.slice(2));
  const buildArgs = [
    "exec",
    "electron-builder",
    "--config",
    "electron-builder.config.js",
    osBuilderFlagMap[os],
    archBuilderFlagMap[arch],
  ];

  console.log(`[bundle] target=${os}/${arch}`);
  console.log(`[bundle] skipPrepare=${skipPrepare} skipBuild=${skipBuild}`);

  const buildEnv = {
    CF_TARGET_OS: os,
    CF_TARGET_ARCH: arch,
    ...createElectronRuntimeMirrorEnv(resolveElectronMirror()),
    ...createElectronBuilderBinariesMirrorEnv(resolveElectronBuilderBinariesMirror()),
  };

  if (dryRun) {
    console.log(`[bundle] dry-run: ${pnpmCommand} ${buildArgs.join(" ")}`);
    process.exit(0);
  }

  if (!skipPrepare) {
    run(pnpmCommand, ["prepare:runtime-assets"], buildEnv);
  }

  if (!skipBuild) {
    run(pnpmCommand, ["build"], buildEnv);
  }

  await runTimedAsync("bundle:electron-builder", () =>
    runElectronBuilderWithRetry(buildArgs, buildEnv),
  );

  runTimedSync("bundle:verify-runtime-dependencies", () =>
    verifyPackagedRuntimeDependencies(os, arch),
  );

  const artifactPath = findBuiltArtifact(os, arch);
  runTimedSync("bundle:audit-bundle-size", () =>
    run(process.execPath, [
      resolve(desktopRoot, "scripts", "audit-bundle-size.mjs"),
      "--artifact-path",
      artifactPath,
    ]),
  );
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entryHref === import.meta.url) {
  try {
    await main();
  } catch (error) {
    console.error(`[bundle] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
