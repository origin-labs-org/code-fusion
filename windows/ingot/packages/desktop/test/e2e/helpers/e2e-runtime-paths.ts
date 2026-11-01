import { join, posix, resolve } from "node:path";

export const E2E_RUNTIME_RELATIVE_ROOT = ".cf-e2e";
export const E2E_RUNTIME_ROOT_REPLAY_TOKEN = "{{e2eRuntimeRoot}}";
const E2E_AGENT_WORKSPACE_NAME = "CfProject";

interface ResolveE2EHomeDirOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export function resolveE2EHomeDir({
  cwd = process.cwd(),
  env = process.env,
}: ResolveE2EHomeDirOptions = {}): string {
  const configuredHome =
    env.CF_E2E_HOME_DIR?.trim() ||
    env.CF_DATA_BASE_DIR?.trim() ||
    env.CF_DESKTOP_HOME_DIR?.trim();
  return resolve(cwd, configuredHome || ".e2e-home");
}

export function resolveE2EStorageRoot(e2eHomeDir = resolveE2EHomeDir()): string {
  return join(e2eHomeDir, ".cf");
}

export function resolveE2ERuntimeRoot(e2eHomeDir = resolveE2EHomeDir()): string {
  return join(e2eHomeDir, E2E_AGENT_WORKSPACE_NAME, E2E_RUNTIME_RELATIVE_ROOT);
}

export function resolveE2ERuntimePath(...segments: string[]): string {
  return join(resolveE2ERuntimeRoot(), ...segments);
}

export function resolveE2EToolPath(...segments: string[]): string {
  return resolveE2ERuntimePath(...segments).replaceAll("\\", "/");
}

export function resolveE2EShellPath(...segments: string[]): string {
  return posix.join(E2E_RUNTIME_RELATIVE_ROOT, ...segments);
}

export function createE2EReplayFixtureVariables(
  e2eHomeDir = resolveE2EHomeDir(),
): Readonly<Record<string, string>> {
  return {
    e2eRuntimeRoot: resolveE2ERuntimeRoot(e2eHomeDir).replaceAll("\\", "/"),
  };
}
