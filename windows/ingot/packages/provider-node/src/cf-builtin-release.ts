import { z } from "zod";
import {
  parseCfBuiltinModelConfigRules,
  parseCfBuiltinProviderConfigRules,
  type ModelConfigRules,
  type ProviderConfigMap,
  type ProviderTemplateMap,
} from "@origin-ai/cf-provider";

export const CF_BUILTIN_RELEASE_SCHEMA_VERSION = 1 as const;
const RETIRED_ZAPI_PROVIDER_ID = "builtin:zapi";

export interface CfBuiltinConfigContent {
  readonly providers: ProviderConfigMap;
  readonly providerTemplates: ProviderTemplateMap;
  readonly modelConfigRules: ModelConfigRules;
}

export interface CfBuiltinRelease {
  readonly schemaVersion: typeof CF_BUILTIN_RELEASE_SCHEMA_VERSION;
  readonly revision: number;
  readonly config: CfBuiltinConfigContent;
}

const releaseSchema = z
  .object({
    schemaVersion: z.literal(CF_BUILTIN_RELEASE_SCHEMA_VERSION),
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    config: z
      .object({
        providerConfigRules: z.unknown(),
        modelConfigRules: z.unknown(),
      })
      .strict(),
  })
  .strict();

export function decodeCfBuiltinRelease(input: unknown): CfBuiltinRelease {
  const parsed = releaseSchema.parse(input);
  const { providers, providerTemplates } = parseCfBuiltinProviderConfigRules(
    parsed.config.providerConfigRules,
  );
  if (providers.has(RETIRED_ZAPI_PROVIDER_ID)) {
    throw new Error(`CodeFusion Built-in Release 包含已Exit的 Provider: ${RETIRED_ZAPI_PROVIDER_ID}`);
  }
  return Object.freeze({
    schemaVersion: CF_BUILTIN_RELEASE_SCHEMA_VERSION,
    revision: parsed.revision,
    config: Object.freeze({
      providers,
      providerTemplates,
      modelConfigRules: parseCfBuiltinModelConfigRules(parsed.config.modelConfigRules),
    }),
  });
}

export function encodeCfBuiltinRelease(release: CfBuiltinRelease): object {
  return {
    schemaVersion: CF_BUILTIN_RELEASE_SCHEMA_VERSION,
    revision: release.revision,
    config: {
      providerConfigRules: {
        templateRules: release.config.providerTemplates.toJSON(),
        providerRules: release.config.providers.toJSON(),
      },
      modelConfigRules: release.config.modelConfigRules.toCfBuiltinJSON(),
    },
  };
}

export function serializeCfBuiltinRelease(release: CfBuiltinRelease): string {
  return JSON.stringify(encodeCfBuiltinRelease(release));
}
