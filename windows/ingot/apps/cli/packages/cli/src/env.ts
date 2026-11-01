import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import {
  CF_RUNTIME_ENV_KEY,
  buildCfToolEnvPassthroughEnv,
  normalizeCfRuntimeEnv,
  sanitizeCfRuntimeEnv,
  sanitizeCfRuntimeEnvInPlace,
  type CfRuntimeEnv,
} from "@origin-ai/cf-shared/runtime-env";

export type CliEnv = Record<string, string | undefined>;

export type DotenvLoadResult = {
  error?: Error;
  keys: string[];
  loaded: boolean;
  path?: string;
};

export type LoadCliDotenvOptions = {
  cwd?: string;
  env?: CliEnv;
};

export function prepareCliRuntimeEnv(
  env: CliEnv = process.env,
  argv: readonly string[] = process.argv,
): CliEnv {
  const prepared = {
    ...sanitizeCfRuntimeEnv(env),
    ...buildCfToolEnvPassthroughEnv(env),
  };
  applyCliRuntimeEnvDefaults(prepared, argv);
  return prepared;
}

export function applyCliRuntimeEnvSanitization(
  env: CliEnv,
  argv: readonly string[] = process.argv,
): void {
  const toolEnvPassthrough = buildCfToolEnvPassthroughEnv(env);
  sanitizeCfRuntimeEnvInPlace(env);
  Object.assign(env, toolEnvPassthrough);
  applyCliRuntimeEnvDefaults(env, argv);
}

export const findDotenv = (startDir: string): string | undefined => {
  let current = resolve(startDir);
  const root = parse(current).root;

  while (true) {
    const candidate = resolve(current, ".env");
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }

    if (current === root) {
      return undefined;
    }

    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
};

export const loadCliDotenv = (options: LoadCliDotenvOptions = {}): DotenvLoadResult => {
  const env = options.env ?? process.env;
  const dotenvPath = findDotenv(options.cwd ?? process.cwd());

  if (!dotenvPath) {
    return {
      keys: [],
      loaded: false,
    };
  }

  // The build used to inline .env values into dist. Loading at the CLI boundary
  // keeps secrets runtime-scoped and lets users rotate .env without rebuilding.
  const result = loadDotenv({
    override: false,
    path: dotenvPath,
    processEnv: env,
    quiet: true,
  });

  if (result.error) {
    return {
      error: result.error,
      keys: [],
      loaded: false,
      path: dotenvPath,
    };
  }

  return {
    keys: Object.keys(result.parsed ?? {}),
    loaded: true,
    path: dotenvPath,
  };
};

export function shouldLoadCliDotenvForProtocolServer(env: CliEnv): boolean {
  return resolveCliRuntimeEnv(env, process.argv) === "development";
}

function applyCliRuntimeEnvDefaults(env: CliEnv, argv: readonly string[]): void {
  env[CF_RUNTIME_ENV_KEY] = resolveCliRuntimeEnv(env, argv);
  applyBetaStorageDefault(env, argv);
}

function resolveCliRuntimeEnv(env: CliEnv, argv: readonly string[]): CfRuntimeEnv {
  const explicit = normalizeCfRuntimeEnv(env[CF_RUNTIME_ENV_KEY]);
  if (explicit) {
    return explicit;
  }

  const entrypoint = (argv[1] ?? "").replace(/\\/g, "/");
  return entrypoint.endsWith(".ts") && entrypoint.includes("packages/cli/src")
    ? "development"
    : "production";
}

function applyBetaStorageDefault(env: CliEnv, argv: readonly string[]): void {
  if (env.CF_STORAGE_DIR?.trim()) return;
  const explicitBeta = env.CF_BETA === "1" || env.CF_ENV === "beta";
  const invokedAsBeta = argv.some((arg) => /(^|[/\\])cf-beta(?:$|\.)/u.test(arg));
  if (!explicitBeta && !invokedAsBeta) return;
  env.CF_STORAGE_DIR = join(homedir(), ".cf-beta");
}
