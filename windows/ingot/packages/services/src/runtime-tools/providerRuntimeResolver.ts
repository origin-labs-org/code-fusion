import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve as resolvePath } from "node:path";
import { CF_AGENT_RUNTIME, sanitizeCfRuntimeEnvInPlace } from "@origin-ai/cf-shared";
import { getDataBaseDir, getProviderWorkspaceConfigDir } from "../paths.js";
import { buildRuntimeProcessEnvPatch } from "./runtimeCommandEnv.js";

const CF_AGENT_WORKDIR_ENV = "CF_AGENT_WORKDIR";

export function resolveProviderConfigDir(
  _legacyProvider: string,
  _workspacePath: string,
  _workspaceIdentity?: string,
): string {
  return getProviderWorkspaceConfigDir();
}

export function buildCleanEnv(
  provider: string,
  _configDir: string,
  extra?: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue;
    if (key.startsWith("ELECTRON_")) continue;
    if (key.startsWith("ORIGINAL_XDG_")) continue;
    if (key === "NODE_OPTIONS") continue;
    if (key === "SHELL" && process.platform === "win32") {
      const winShell = process.env.ComSpec || "cmd.exe";
      env.SHELL = winShell;
      continue;
    }
    if (key === "GOOGLE_API_KEY") continue;
    env[key] = value;
  }
  sanitizeCfRuntimeEnvInPlace(env);
  if (process.platform === "win32") {
    const nonCanonicalPathKey = Object.keys(env).find(
      (k) => k.toUpperCase() === "PATH" && k !== "PATH",
    );
    if (nonCanonicalPathKey && env[nonCanonicalPathKey]) {
      env.PATH = env[nonCanonicalPathKey]!;
      delete env[nonCanonicalPathKey];
    }
  }
  if (provider === "glm") {
    const glmHome = getDataBaseDir();
    env.HOME = glmHome;
    if (process.platform === "win32") {
      env.USERPROFILE = glmHome;
    }
  }
  Object.assign(env, buildRuntimeProcessEnvPatch(env));
  if (extra) Object.assign(env, extra);
  return env;
}

const packagedResourcesPath =
  typeof (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath === "string"
    ? (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
    : null;

function resolveExistingPath(candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolvePlatformScopedBundledAgentRoots(moduleDir?: string): Array<string | null> {
  const platformKey = `${process.platform}-${process.arch}`;
  return [
    resolvePath(process.cwd(), "bundled-agents", platformKey),
    resolvePath(process.cwd(), "packages", "desktop", "bundled-agents", platformKey),
    resolvePath(process.cwd(), "..", "desktop", "bundled-agents", platformKey),
    moduleDir ? resolvePath(moduleDir, "..", "..", "desktop", "bundled-agents", platformKey) : null,
    moduleDir ? resolvePath(moduleDir, "..", "..", "bundled-agents", platformKey) : null,
  ];
}

function resolveLegacyBundledResourceRoots(moduleDir?: string): Array<string | null> {
  return [
    resolvePath(process.cwd(), "bundled-resources"),
    resolvePath(process.cwd(), "packages", "desktop", "bundled-resources"),
    resolvePath(process.cwd(), "..", "desktop", "bundled-resources"),
    moduleDir ? resolvePath(moduleDir, "..", "..", "desktop", "bundled-resources") : null,
    moduleDir ? resolvePath(moduleDir, "..", "..", "bundled-resources") : null,
  ];
}

export function findCfAgentRuntimeBinary(): string | null {
  const runtime = CF_AGENT_RUNTIME;
  const entrySegments = runtime.resolveEntrySegments(process.platform);
  const resourceSegments = [runtime.bundledResourceDir, ...entrySegments];
  const envPath = process.env[runtime.binaryEnvVar];
  if (envPath && existsSync(envPath)) {
    return envPath;
  }

  const moduleDir: string | undefined = import.meta.dirname;
  const platformScopedRoots = resolvePlatformScopedBundledAgentRoots(moduleDir);
  const legacyRoots = resolveLegacyBundledResourceRoots(moduleDir);

  const candidates = [
    packagedResourcesPath ? resolvePath(packagedResourcesPath, ...resourceSegments) : null,
    resolvePath(homedir(), ".cf", "server", "agents", ...resourceSegments),
    ...platformScopedRoots.map((root) =>
      root ? resolvePath(root, runtime.bundledResourceDir, ...entrySegments) : null,
    ),
    ...legacyRoots.map((root) => (root ? resolvePath(root, ...resourceSegments) : null)),
  ];
  return resolveExistingPath(candidates);
}

export function findCfAgentRuntimeNodeBundle(): string | null {
  const runtime = CF_AGENT_RUNTIME;
  const entrySegments = runtime.resolveNodeBundleSegments();
  const resourceSegments = [runtime.bundledResourceDir, ...entrySegments];

  const moduleDir: string | undefined = import.meta.dirname;
  const platformScopedRoots = resolvePlatformScopedBundledAgentRoots(moduleDir);
  const legacyRoots = resolveLegacyBundledResourceRoots(moduleDir);

  const candidates = [
    packagedResourcesPath ? resolvePath(packagedResourcesPath, ...resourceSegments) : null,
    resolvePath(homedir(), ".cf", "server", "agents", ...resourceSegments),
    ...platformScopedRoots.map((root) =>
      root ? resolvePath(root, runtime.bundledResourceDir, ...entrySegments) : null,
    ),
    ...legacyRoots.map((root) => (root ? resolvePath(root, ...resourceSegments) : null)),
  ];
  return resolveExistingPath(candidates);
}

export function findBinary(provider: string): string | null {
  if (provider !== "glm") {
    return null;
  }
  const devEntry = findGlmDevEntry();
  if (devEntry) {
    return devEntry.agentPath;
  }
  return findCfAgentRuntimeBinary();
}

interface GlmDevEntry {
  workdir: string;
  entryArg: string;
  agentPath: string;
}

function resolveGlmDevEntry(workdir: string): GlmDevEntry | null {
  const candidates = [
    ["packages", "cli", "src", "main.ts"],
    ["src", "cli.ts"],
  ];
  for (const segments of candidates) {
    const agentPath = resolvePath(workdir, ...segments);
    if (existsSync(agentPath)) {
      return {
        workdir,
        entryArg: segments.join("/"),
        agentPath,
      };
    }
  }
  return null;
}

function findGlmDevEntry(): GlmDevEntry | null {
  const workdir = process.env[CF_AGENT_WORKDIR_ENV];
  if (workdir) {
    const entry = resolveGlmDevEntry(workdir);
    if (entry) {
      return entry;
    }
  }
  const repoRoot = findWorkspaceRoot(process.cwd());
  const anchorDirs = [repoRoot, process.cwd()].filter((anchor): anchor is string =>
    Boolean(anchor),
  );
  const candidates = ["cf-cli", "glm", "cc-refactor"];
  const seen = new Set<string>();
  for (const anchorDir of anchorDirs) {
    for (const name of candidates) {
      const candidate = resolvePath(anchorDir, "..", name);
      if (seen.has(candidate)) {
        continue;
      }
      seen.add(candidate);
      const entry = resolveGlmDevEntry(candidate);
      if (entry) {
        return entry;
      }
    }
  }
  return null;
}

function findWorkspaceRoot(startDir: string): string | null {
  let current = resolvePath(startDir);
  while (true) {
    if (existsSync(resolvePath(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}
