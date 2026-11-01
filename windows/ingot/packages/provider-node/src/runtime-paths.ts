export const CF_BUILTIN_PROVIDER_CONFIG_FILE_ENV = "CF_BUILTIN_PROVIDER_CONFIG_FILE";
export const CF_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE_ENV =
  "CF_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE";
export const CF_PERSONAL_PROVIDER_CONFIG_FILE_ENV = "CF_PERSONAL_PROVIDER_CONFIG_FILE";
export const PERSONAL_PROVIDER_CONFIG_FILE_NAME = "provider_config.json";

export interface NodeProviderRuntimePaths {
  readonly cfBuiltinFilePath: string;
  readonly personalFilePath: string;
}

export function createNodeProviderRuntimePathEnv(
  paths: NodeProviderRuntimePaths,
): Record<string, string> {
  return {
    [CF_BUILTIN_PROVIDER_CONFIG_FILE_ENV]: paths.cfBuiltinFilePath,
    [CF_PERSONAL_PROVIDER_CONFIG_FILE_ENV]: paths.personalFilePath,
  };
}

export function resolveNodeProviderRuntimePaths(
  env: Readonly<Record<string, string | undefined>>,
): NodeProviderRuntimePaths | null {
  const cfBuiltinFilePath = env[CF_BUILTIN_PROVIDER_CONFIG_FILE_ENV]?.trim();
  const personalFilePath = env[CF_PERSONAL_PROVIDER_CONFIG_FILE_ENV]?.trim();
  if (!cfBuiltinFilePath && !personalFilePath) return null;
  if (!cfBuiltinFilePath || !personalFilePath) {
    throw new Error("CodeFusion Built-in 与 Personal Provider Config 路径必须同时提供");
  }
  return Object.freeze({ cfBuiltinFilePath, personalFilePath });
}
