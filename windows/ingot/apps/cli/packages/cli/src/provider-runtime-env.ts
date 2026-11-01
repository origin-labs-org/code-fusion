import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  materializeCfBuiltinProviderConfig,
  NodeCfBuiltinProviderConfigSource,
  PERSONAL_PROVIDER_CONFIG_FILE_NAME,
  resolveCfBuiltinCachePaths,
  resolveCfBuiltinClientPlatform,
  CF_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE_ENV,
  CF_BUILTIN_PROVIDER_CONFIG_FILE_ENV,
  CF_PERSONAL_PROVIDER_CONFIG_FILE_ENV,
  type CfBuiltinRefreshEvent,
} from "@origin-ai/cf-provider-node";
import { resolveRuntimeCfEndpointOrigin, CF_VERSION } from "@origin-ai/cf-shared";
import type { CliEnv } from "./env.js";

export const SEA_CF_BUILTIN_PROVIDER_CONFIG_ASSET_KEY = "cf-provider/cf-builtin.json";

export function createCliProviderRefreshReporter(
  stderr: Pick<NodeJS.WriteStream, "write"> = process.stderr,
) {
  return {
    onBuiltinRefreshError(error: unknown) {
      stderr.write(
        `CodeFusion Built-in RefreshFailed: ${error instanceof Error ? error.message : "unknown error"}\n`,
      );
    },
    onBuiltinRefreshResult(event: CfBuiltinRefreshEvent) {
      if (event.result === "updated" || process.env.NODE_ENV !== "production") {
        stderr.write(
          `CodeFusion Built-in ${event.result}${event.reason ? ` (${event.reason})` : ""}${event.revision === undefined ? "" : ` revision=${event.revision} source=CDN`}\n`,
        );
      }
    },
  };
}

type SeaProviderConfigAssets = Pick<typeof import("node:sea"), "getAsset" | "isSea">;

interface PrepareCliProviderRuntimeEnvOptions {
  readonly argv: readonly string[];
  readonly env: CliEnv;
  readonly dataBaseDir?: string;
  readonly entrypoint?: string;
  readonly sea?: SeaProviderConfigAssets;
  readonly appVersion?: string;
  readonly platform?: string;
}

export async function prepareCliProviderRuntimeEnv(
  options: PrepareCliProviderRuntimeEnvOptions,
): Promise<Record<string, string>> {
  if (!requiresProviderRuntime(options.argv)) return {};

  const explicitCfBuiltin = options.env[CF_BUILTIN_PROVIDER_CONFIG_FILE_ENV]?.trim();
  const explicitPersonal = options.env[CF_PERSONAL_PROVIDER_CONFIG_FILE_ENV]?.trim();
  const dataBaseDir = options.dataBaseDir ?? options.env.CF_DATA_BASE_DIR?.trim() ?? homedir();
  if (explicitCfBuiltin && explicitPersonal) {
    return {
      [CF_BUILTIN_PROVIDER_CONFIG_FILE_ENV]: explicitCfBuiltin,
      [CF_PERSONAL_PROVIDER_CONFIG_FILE_ENV]: explicitPersonal,
    };
  }

  const cfBuiltinFilePath =
    explicitCfBuiltin ??
    (await resolveBundledCfBuiltinProviderConfig({
      dataBaseDir,
      entrypoint: options.entrypoint ?? process.argv[1],
      sea: options.sea ?? getSeaProviderConfigAssets(),
    }));
  const personalFilePath =
    explicitPersonal ?? join(dataBaseDir, ".cf", "v2", PERSONAL_PROVIDER_CONFIG_FILE_NAME);
  const appVersion = options.appVersion ?? CF_VERSION;
  const platform = options.platform ?? resolveCfBuiltinClientPlatform();
  const cfEndpointOrigin = resolveRuntimeCfEndpointOrigin(options.env);
  const cachePaths = resolveCfBuiltinCachePaths({
    environmentConfigRoot: join(dataBaseDir, ".cf", "v2"),
    platform,
    appVersion,
    cfEndpointOrigin,
  });
  const source = new NodeCfBuiltinProviderConfigSource({
    bundledFilePath: cfBuiltinFilePath,
    activeFilePath: cachePaths.activeFilePath,
    watch: false,
  });
  try {
    await source.read();
  } finally {
    source.dispose();
  }

  return {
    [CF_BUILTIN_PROVIDER_CONFIG_FILE_ENV]: cachePaths.activeFilePath,
    [CF_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE_ENV]: cfBuiltinFilePath,
    [CF_PERSONAL_PROVIDER_CONFIG_FILE_ENV]: personalFilePath,
  };
}

function requiresProviderRuntime(argv: readonly string[]): boolean {
  if (argv.some((arg) => arg === "--help" || arg === "-h" || arg === "--version" || arg === "-v")) {
    return false;
  }
  if (
    argv.some(
      (arg) =>
        arg === "--prompt" ||
        arg.startsWith("--prompt=") ||
        arg === "--target" ||
        arg.startsWith("--target="),
    )
  ) {
    return true;
  }

  const command = argv[0];
  if (command === undefined || command.startsWith("-")) return true;
  return (
    command === "tui" ||
    command === "app-server" ||
    command === "agent-server" ||
    command === "login" ||
    command === "logout"
  );
}

async function resolveBundledCfBuiltinProviderConfig(input: {
  readonly dataBaseDir: string;
  readonly entrypoint: string | undefined;
  readonly sea: SeaProviderConfigAssets | undefined;
}): Promise<string> {
  if (input.sea?.isSea()) {
    const content = input.sea.getAsset(SEA_CF_BUILTIN_PROVIDER_CONFIG_ASSET_KEY, "utf8");
    return materializeCfBuiltinProviderConfig({
      environmentConfigRoot: join(input.dataBaseDir, ".cf", "v2"),
      content,
    });
  }

  const entrypoint = input.entrypoint?.trim();
  if (!entrypoint) throw new Error("无法定位 CLI CodeFusion Built-in Provider Config：缺少入口路径");
  const entryDirectory = dirname(realpathSync(resolve(entrypoint)));
  const candidates = [
    join(entryDirectory, "provider", "cf-builtin.json"),
    resolve(entryDirectory, "../../../../../config/provider/cf-builtin.json"),
  ];
  const candidate = candidates.find((filePath) => existsSync(filePath));
  if (candidate) return candidate;
  throw new Error(`无法定位 CLI CodeFusion Built-in Provider Config：${candidates.join(", ")}`);
}

function getSeaProviderConfigAssets(): SeaProviderConfigAssets | undefined {
  const getBuiltinModule = process.getBuiltinModule as
    | ((id: "node:sea") => typeof import("node:sea"))
    | undefined;
  return getBuiltinModule?.("node:sea");
}
