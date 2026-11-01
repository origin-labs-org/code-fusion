import { materializeCfBuiltinProviderConfig } from "@origin-ai/cf-services/node";

declare const __CF_BUILTIN_PROVIDER_CONFIG_JSON__: string | undefined;

export interface MaterializeBundledCfBuiltinProviderConfigOptions {
  readonly environmentConfigRoot: string;
  readonly content: string;
}

export function readBundledCfBuiltinProviderConfig(): string {
  if (typeof __CF_BUILTIN_PROVIDER_CONFIG_JSON__ !== "string") {
    throw new Error("当前构建未嵌入 CodeFusion Built-in Provider Config");
  }
  return __CF_BUILTIN_PROVIDER_CONFIG_JSON__;
}

export async function materializeBundledCfBuiltinProviderConfig(
  options: MaterializeBundledCfBuiltinProviderConfigOptions,
): Promise<string> {
  return materializeCfBuiltinProviderConfig(options);
}
