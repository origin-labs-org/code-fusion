import { access } from "node:fs/promises";
import { join } from "node:path";

export interface BundledAgentWiring {
  CF_AGENT_SERVER_COMMAND: string;
  CF_AGENT_SERVER_ARGS_JSON: string;
}

export function createReleaseAgentWiring(
  runtimeRoot: string,
  runtimeNode: string,
  env: Record<string, string | undefined>,
): BundledAgentWiring | null {
  if (env.CF_AGENT_SERVER_COMMAND?.trim()) return null;
  return {
    CF_AGENT_SERVER_COMMAND: runtimeNode,
    CF_AGENT_SERVER_ARGS_JSON: JSON.stringify([
      join(runtimeRoot, "cf.cjs"),
      "app-server",
      "--stdio",
    ]),
  };
}

export async function resolveBundledAgentWiring(
  entryDir: string,
  env: Record<string, string | undefined>,
): Promise<BundledAgentWiring | null> {
  if (env.CF_AGENT_SERVER_COMMAND?.trim()) {
    return null;
  }
  const bundlePath = join(entryDir, "cf.cjs");
  try {
    await access(bundlePath);
  } catch {
    return null;
  }
  return {
    CF_AGENT_SERVER_COMMAND: process.execPath,
    CF_AGENT_SERVER_ARGS_JSON: JSON.stringify([bundlePath, "app-server", "--stdio"]),
  };
}
