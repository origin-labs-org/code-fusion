import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CF_PLUGIN_HOST_COMMAND } from "@origin-ai/cf-contracts/plugins";
import {
  getCapturedCfCuaBrokerCredentials,
  CF_CUA_BROKER_SOCKET_ENV_KEY,
  CF_CUA_NODE_REPL_HOST_ENV_KEY,
} from "@origin-ai/cf-shared/runtime-env";
import { CF_CUA_OFFICIAL_PLUGIN_ID, CF_PLUGIN_ID_ENV_KEY } from "@origin-ai/cf-shared/mcp";
import type { RunContext } from "@origin-ai/cf-shared-types";

const HOST_USAGE = `${CF_PLUGIN_HOST_COMMAND} <server-path> [-- <server-arg>...]`;

type HostedPluginModule = {
  main?: unknown;
};

export function isPluginHostInvocation(argv: readonly string[]): boolean {
  return argv[0] === CF_PLUGIN_HOST_COMMAND;
}

export async function runPluginHostCommand(ctx: RunContext, argv: string[]): Promise<number> {
  if (argv.length < 1) {
    ctx.stderr.write(`Usage: ${HOST_USAGE}\n`);
    return 1;
  }

  const [rawServerPath, ...serverArgs] = argv;

  try {
    if (rawServerPath === undefined) {
      throw new Error("Plugin server path is required.");
    }

    const serverPath = resolve(rawServerPath);
    if (!existsSync(serverPath)) {
      throw new Error("Plugin server file does not exist.");
    }
    const capturedBrokerCredentials = getCapturedCfCuaBrokerCredentials();
    assertCapturedBrokerLaunchIsAuthorized(capturedBrokerCredentials);
    const module = (await import(pathToFileURL(serverPath).href)) as HostedPluginModule;
    if (typeof module.main !== "function") {
      throw new Error("Plugin server does not export main().");
    }

    const originalArgv = process.argv;
    const originalBrokerSocket = process.env[CF_CUA_BROKER_SOCKET_ENV_KEY];
    process.argv = [process.execPath, serverPath, ...serverArgs];
    if (capturedBrokerCredentials.socket && process.env[CF_CUA_NODE_REPL_HOST_ENV_KEY] === "1") {
      process.env[CF_CUA_BROKER_SOCKET_ENV_KEY] = capturedBrokerCredentials.socket;
    }
    try {
      await module.main();
    } finally {
      process.argv = originalArgv;
      if (originalBrokerSocket === undefined) {
        delete process.env[CF_CUA_BROKER_SOCKET_ENV_KEY];
      } else {
        process.env[CF_CUA_BROKER_SOCKET_ENV_KEY] = originalBrokerSocket;
      }
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.stderr.write(`Plugin host failed: ${message}\n`);
    return 1;
  }
}

type CapturedBrokerCredentials = ReturnType<typeof getCapturedCfCuaBrokerCredentials>;

function assertCapturedBrokerLaunchIsAuthorized(credentials: CapturedBrokerCredentials): void {
  const hasCapturedCredentials = Boolean(credentials.socket || credentials.pluginAuthority);
  if (!hasCapturedCredentials) return;

  const pluginId = process.env[CF_PLUGIN_ID_ENV_KEY]?.trim().toLowerCase();
  if (
    credentials.socket === undefined ||
    credentials.pluginAuthority === undefined ||
    pluginId !== CF_CUA_OFFICIAL_PLUGIN_ID ||
    process.env[CF_CUA_NODE_REPL_HOST_ENV_KEY] !== "1"
  ) {
    throw new Error(
      "Captured CodeFusion CUA broker credentials may only launch the trusted shared node_repl host",
    );
  }
}
