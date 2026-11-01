
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  BUILTIN_MODEL_PROVIDER_IDS,
  resolveBigModelApiOrigin,
  resolveRuntimeCfEnv,
} from "@origin-ai/cf-shared";
import {
  createModelProviderModelConfig,
  getDefaultModelSupportedFormatsFromApiFormat,
  getDefaultModelSupportedFormatsFromEndpoints,
  getDefaultModelProviderEndpointPathForKind,
  getModelProviderModelIds,
  isModelProviderModelConfig,
  legacyModelProviderListSchema,
  mapModelProviderSupportedFormatToKind,
  migrateLegacyModelProviderConfig,
  MODEL_PROVIDER_NEW_MODEL_CONTEXT_WINDOW,
  modelProviderApiFormatSchema,
  modelProviderCatalogSourceIdSchema,
  modelProviderEndpointsSchema,
  modelProviderKindSchema,
  modelProviderReasoningSpecSchema,
  modelProviderSourceSchema,
  modelProviderSystemDisabledReasonSchema,
  normalizeModelProviderBaseUrlForKind,
  normalizeModelProviderConfiguredBaseUrl,
  resolveModelProviderDefaultKind,
  resolveModelProviderContextWindow,
  resolveModelProviderKindApiFormat,
  resolveModelProviderApiFormat,
  resolveModelProviderRuntimeBaseUrl,
  stripLegacyClaudeProviderMappings,
  stripModelProviderReasoningPatches,
  type ModelProviderApiFormat,
  type ModelProviderCatalogSourceId,
  type ModelProviderConfig,
  type ModelProviderEndpoints,
  type ModelProviderKind,
  type ModelProviderModelConfig,
  type ModelProviderModality,
  type ModelProviderReasoningSpec,
  type ModelProviderSource,
  type ModelProviderSystemDisabledReason,
  type ProviderModelMappings,
} from "./legacyModelProviderSerialized.js";
import { getAppConfigDir } from "../paths.js";

const LEGACY_PRESET_GLM_PROVIDER_IDS = new Set<string>([
  "zai-api",
  BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
  BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
  "bigmodel-api",
  BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
  BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
]);

function isLegacyPresetGlmProviderId(providerId: string): boolean {
  return LEGACY_PRESET_GLM_PROVIDER_IDS.has(providerId);
}

const BIGMODEL_CODING_PLAN_ANTHROPIC_BASE_URL = "https://open.bigmodel.cn/api/anthropic";

function normalizeBigModelCodingPlanAnthropicBaseUrlForEnv(
  baseUrl: string | undefined,
  env: Record<string, string | undefined> = process.env,
): string {
  const fallbackBaseUrl =
    resolveRuntimeCfEnv(env) === "production"
      ? BIGMODEL_CODING_PLAN_ANTHROPIC_BASE_URL
      : `${resolveBigModelApiOrigin(env)}/api/anthropic`;
  const normalizedBaseUrl = normalizeModelProviderBaseUrlForKind(
    baseUrl ?? fallbackBaseUrl,
    "anthropic",
  );
  if (resolveRuntimeCfEnv(env) === "production") {
    return normalizedBaseUrl || fallbackBaseUrl;
  }

  try {
    const parsed = new URL(normalizedBaseUrl || fallbackBaseUrl);
    const productionParsed = new URL(BIGMODEL_CODING_PLAN_ANTHROPIC_BASE_URL);
    return parsed.origin === productionParsed.origin
      ? fallbackBaseUrl
      : normalizedBaseUrl || fallbackBaseUrl;
  } catch {
    return fallbackBaseUrl;
  }
}

function getCfConfigFilePath(): string {
  return join(getAppConfigDir(), "config.json");
}

const LEGACY_FALLBACK_CONTEXT_WINDOW = MODEL_PROVIDER_NEW_MODEL_CONTEXT_WINDOW;
const RETIRED_ZAPI_PROVIDER_ID = "builtin:zapi";

type JsonObject = Record<string, unknown>;

interface CfConfigFile {
  $schema?: string;
  provider?: Record<string, CfOpenCodeProviderConfig>;
  [key: string]: unknown;
}

interface CfOpenCodeProviderConfig {
  api?: string;
  name?: string;
  env?: string[];
  id?: string;
  kind?: ModelProviderKind;
  npm?: string;
  whitelist?: string[];
  blacklist?: string[];
  options?: JsonObject;
  enabled?: boolean;
  systemDisabledReason?: ModelProviderSystemDisabledReason;
  endpoints?: ModelProviderEndpoints;
  apiFormat?: ModelProviderApiFormat;
  source?: ModelProviderSource;
  catalogSourceId?: ModelProviderCatalogSourceId;
  catalogProviderId?: string;
  modelsDevProviderId?: string;
  apiKeyRequired?: boolean;
  headers?: Record<string, string>;
  logoUrl?: string;
  apiKeyUrl?: string;
  defaultKind?: ModelProviderKind;
  providerMappings?: ProviderModelMappings;
  createdAt?: number;
  updatedAt?: number;
  models?: Record<string, CfOpenCodeModelConfig>;
  cf?: CfProviderConfigExtension;
  [key: string]: unknown;
}

interface CfOpenCodeModelConfig {
  id?: string;
  name?: string;
  family?: string;
  release_date?: string;
  attachment?: boolean;
  reasoning?: boolean | CfReasoningConfigExtension;
  temperature?: boolean;
  tool_call?: boolean;
  interleaved?: unknown;
  cost?: JsonObject;
  limit?: {
    context?: number;
    input?: number;
    output?: number;
  };
  contextWindow?: number;
  maxOutputTokens?: number;
  modalities?: {
    input?: ModelProviderModality[];
    output?: ModelProviderModality[];
  };
  experimental?: boolean;
  status?: string;
  provider?: {
    npm?: string;
    api?: string;
  };
  options?: JsonObject;
  headers?: Record<string, string>;
  variants?: Record<string, JsonObject>;
  kinds?: ModelProviderKind[];
  defaultKind?: ModelProviderKind;
  modelIdByKind?: Partial<Record<ModelProviderKind, string>>;
  disabledReason?: string;
  supportsTools?: boolean;
  supportsStructuredOutput?: boolean;
  reasoningSpec?: ModelProviderReasoningSpec;
  hasMaxOutputTokens?: boolean;
  priority?: number;
  modified?: boolean;
  deleted?: boolean;
  cf?: CfModelConfigExtension;
  [key: string]: unknown;
}

interface CfReasoningConfigExtension {
  enabled?: boolean;
  variants?: string[];
  defaultVariant?: string;
  aliases?: Record<string, string>;
}

interface CfProviderConfigExtension {
  enabled?: boolean;
  systemDisabledReason?: ModelProviderSystemDisabledReason;
  endpoints?: ModelProviderEndpoints;
  apiFormat?: ModelProviderApiFormat;
  source?: ModelProviderSource;
  catalogSourceId?: ModelProviderCatalogSourceId;
  catalogProviderId?: string;
  modelsDevProviderId?: string;
  apiKeyRequired?: boolean;
  headers?: Record<string, string>;
  logoUrl?: string;
  apiKeyUrl?: string;
  defaultKind?: ModelProviderKind;
  providerMappings?: ProviderModelMappings;
  createdAt?: number;
  updatedAt?: number;
  deletedModels?: string[];
}

interface CfModelConfigExtension {
  kinds?: ModelProviderKind[];
  defaultKind?: ModelProviderKind;
  modelIdByKind?: Partial<Record<ModelProviderKind, string>>;
  disabledReason?: string;
  supportsTools?: boolean;
  supportsStructuredOutput?: boolean;
  reasoning?: ModelProviderReasoningSpec;
  hasMaxOutputTokens?: boolean;
  priority?: number;
  modified?: boolean;
  deleted?: boolean;
}

const jsonObjectSchema = z.record(z.string(), z.unknown());
const cfModelProviderModalitySchema = z.enum(["text", "image", "video", "audio", "pdf"]);
const cfProviderModelMappingsSchema = z.record(z.string(), z.unknown());

const cfReasoningConfigExtensionSchema = z
  .object({
    enabled: z.boolean().optional(),
    variants: z.array(z.string().min(1)).optional(),
    defaultVariant: z.string().min(1).optional(),
    aliases: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const cfModelConfigExtensionSchema = z
  .object({
    kinds: z.array(modelProviderKindSchema).optional(),
    defaultKind: modelProviderKindSchema.optional(),
    modelIdByKind: z.partialRecord(modelProviderKindSchema, z.string().min(1)).optional(),
    disabledReason: z.string().optional(),
    supportsTools: z.boolean().optional(),
    supportsStructuredOutput: z.boolean().optional(),
    reasoning: modelProviderReasoningSpecSchema.optional(),
    hasMaxOutputTokens: z.boolean().optional(),
    priority: z.number().finite().optional(),
    modified: z.boolean().optional(),
    deleted: z.boolean().optional(),
  })
  .passthrough();

const cfOpenCodeModelConfigSchema: z.ZodType<CfOpenCodeModelConfig> = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    reasoning: z.union([z.boolean(), cfReasoningConfigExtensionSchema]).optional(),
    limit: z
      .object({
        context: z.number().positive().optional(),
        input: z.number().positive().optional(),
        output: z.number().positive().optional(),
      })
      .optional(),
    contextWindow: z.number().positive().optional(),
    maxOutputTokens: z.number().positive().optional(),
    modalities: z
      .object({
        input: z.array(cfModelProviderModalitySchema).optional(),
        output: z.array(cfModelProviderModalitySchema).optional(),
      })
      .optional(),
    options: jsonObjectSchema.optional(),
    headers: z.record(z.string(), z.string()).optional(),
    variants: z.record(z.string(), jsonObjectSchema).optional(),
    kinds: z.array(modelProviderKindSchema).optional(),
    defaultKind: modelProviderKindSchema.optional(),
    modelIdByKind: z.partialRecord(modelProviderKindSchema, z.string().min(1)).optional(),
    disabledReason: z.string().optional(),
    supportsTools: z.boolean().optional(),
    supportsStructuredOutput: z.boolean().optional(),
    reasoningSpec: modelProviderReasoningSpecSchema.optional(),
    hasMaxOutputTokens: z.boolean().optional(),
    priority: z.number().finite().optional(),
    modified: z.boolean().optional(),
    deleted: z.boolean().optional(),
    cf: cfModelConfigExtensionSchema.optional(),
  })
  .passthrough();

const cfProviderConfigExtensionSchema = z
  .object({
    enabled: z.boolean().optional(),
    systemDisabledReason: modelProviderSystemDisabledReasonSchema.optional(),
    endpoints: modelProviderEndpointsSchema.optional(),
    apiFormat: modelProviderApiFormatSchema.optional(),
    source: modelProviderSourceSchema.optional(),
    catalogSourceId: modelProviderCatalogSourceIdSchema.optional(),
    catalogProviderId: z.string().optional(),
    modelsDevProviderId: z.string().optional(),
    apiKeyRequired: z.boolean().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    logoUrl: z.string().optional(),
    apiKeyUrl: z.string().optional(),
    defaultKind: modelProviderKindSchema.optional(),
    providerMappings: cfProviderModelMappingsSchema.optional(),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
    deletedModels: z.array(z.string().min(1)).optional(),
  })
  .passthrough();

const cfOpenCodeProviderConfigSchema: z.ZodType<CfOpenCodeProviderConfig> = z
  .object({
    api: z.string().optional(),
    name: z.string().optional(),
    env: z.array(z.string()).optional(),
    id: z.string().optional(),
    kind: modelProviderKindSchema.optional(),
    npm: z.string().optional(),
    whitelist: z.array(z.string()).optional(),
    blacklist: z.array(z.string()).optional(),
    options: jsonObjectSchema.optional(),
    enabled: z.boolean().optional(),
    systemDisabledReason: modelProviderSystemDisabledReasonSchema.optional(),
    endpoints: modelProviderEndpointsSchema.optional(),
    apiFormat: modelProviderApiFormatSchema.optional(),
    source: modelProviderSourceSchema.optional(),
    catalogSourceId: modelProviderCatalogSourceIdSchema.optional(),
    catalogProviderId: z.string().optional(),
    modelsDevProviderId: z.string().optional(),
    apiKeyRequired: z.boolean().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    logoUrl: z.string().optional(),
    apiKeyUrl: z.string().optional(),
    defaultKind: modelProviderKindSchema.optional(),
    providerMappings: cfProviderModelMappingsSchema.optional(),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
    models: z.record(z.string(), cfOpenCodeModelConfigSchema).optional(),
    cf: cfProviderConfigExtensionSchema.optional(),
  })
  .passthrough();

const cfConfigFileSchema = z
  .object({
    $schema: z.string().optional(),
    provider: z.record(z.string(), cfOpenCodeProviderConfigSchema).optional(),
  })
  .passthrough();

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function readPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
    const normalizedKey = key.trim();
    const normalizedValue = readString(item);
    return normalizedKey && normalizedValue ? [[normalizedKey, normalizedValue] as const] : [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function inferModelProviderKindFromOpenCodeProvider(
  provider: CfOpenCodeProviderConfig,
): ModelProviderKind {
  if (provider.kind) {
    return provider.kind;
  }
  const npm = provider.npm?.toLowerCase() ?? "";
  if (npm.includes("anthropic")) {
    return "anthropic";
  }
  if (npm.includes("openai-compatible")) {
    return "openai-compatible";
  }
  if (npm.includes("openai")) {
    return "openai";
  }
  return "openai-compatible";
}

function hasOpenCodeProviderRuntimeFields(provider: CfOpenCodeProviderConfig): boolean {
  return Boolean(
    provider.kind ||
    readString(provider.options?.baseURL) ||
    readString(provider.api) ||
    provider.npm?.trim(),
  );
}

function resolveOpenCodeProviderDefaultKind(
  provider: CfOpenCodeProviderConfig,
): ModelProviderKind {
  if (provider.kind) {
    return provider.kind;
  }
  if (readString(provider.options?.baseURL) || readString(provider.api) || provider.npm?.trim()) {
    return inferModelProviderKindFromOpenCodeProvider(provider);
  }
  return (
    provider.defaultKind ??
    provider.cf?.defaultKind ??
    inferModelProviderKindFromOpenCodeProvider(provider)
  );
}

function resolvePresetProviderKindFromRuntimeBaseUrl(
  providerId: string,
  baseURL: string | undefined,
): ModelProviderKind | undefined {
  if (!baseURL || !isLegacyPresetGlmProviderId(providerId)) {
    return undefined;
  }

  const normalized = baseURL.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  const path = resolveRuntimeBaseUrlPath(normalized);

  if (isBigModelCodingPlanLegacyOpenAiRuntime(providerId, normalized)) {
    return "anthropic";
  }
  if (path.includes("/coding/paas/v4")) {
    return "openai-compatible";
  }
  if (path.includes("/api/anthropic") || path.includes("/cf-plan/anthropic")) {
    return "anthropic";
  }
  return undefined;
}

function resolveRuntimeBaseUrlPath(baseURL: string): string {
  try {
    return new URL(baseURL).pathname.toLowerCase();
  } catch {
    return baseURL.toLowerCase();
  }
}

function isBigModelCodingPlanLegacyOpenAiRuntime(
  providerId: string,
  baseURL: string | undefined,
): boolean {
  if (providerId !== BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan) {
    return false;
  }
  const normalized = baseURL?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return false;
  }
  return resolveRuntimeBaseUrlPath(normalized).includes("/coding/paas/v4");
}

function resolveOpenCodeProviderEndpoints(
  provider: CfOpenCodeProviderConfig,
  defaultKind: ModelProviderKind,
  providerId: string,
): ModelProviderEndpoints {
  const baseURL = readString(provider.options?.baseURL) ?? readString(provider.api);
  if (baseURL) {
    if (isBigModelCodingPlanLegacyOpenAiRuntime(providerId, baseURL)) {
      return {
        baseURL: normalizeBigModelCodingPlanAnthropicBaseUrlForEnv(undefined),
        paths: {
          anthropic: "/v1/messages",
        },
      };
    }
    if (providerId === BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan) {
      return {
        baseURL: normalizeBigModelCodingPlanAnthropicBaseUrlForEnv(baseURL),
        paths: {
          anthropic: "/v1/messages",
        },
      };
    }
    const normalizedBaseURL = normalizeModelProviderConfiguredBaseUrl(baseURL);
    return {
      baseURL: normalizedBaseURL,
      paths: {
        [defaultKind]: getDefaultModelProviderEndpointPathForKind(defaultKind),
      },
    };
  }
  return provider.endpoints ?? provider.cf?.endpoints ?? {};
}

function stripCfPrefixedProviderMappings(
  providerMappings: ProviderModelMappings | undefined,
): ProviderModelMappings | undefined {
  if (!providerMappings) {
    return undefined;
  }
  const entries = Object.entries(providerMappings ?? {}).filter(
    ([key]) => !key.toLowerCase().startsWith("cf"),
  );
  return Object.fromEntries(entries);
}

function openCodeReasoningToModelReasoning(
  model: CfOpenCodeModelConfig,
  options: { preferOpenCodeFields: boolean },
): ModelProviderReasoningSpec | undefined {
  if (!options.preferOpenCodeFields && model.reasoningSpec) {
    return stripModelProviderReasoningPatches(model.reasoningSpec);
  }
  if (!options.preferOpenCodeFields && model.cf?.reasoning) {
    return stripModelProviderReasoningPatches(model.cf.reasoning);
  }
  const reasoning = model.reasoning;
  if (reasoning === undefined || reasoning === false) {
    return undefined;
  }
  const reasoningConfig = typeof reasoning === "object" ? reasoning : undefined;
  if (reasoningConfig?.enabled === false) {
    return undefined;
  }
  const variantKeys = reasoningConfig?.variants ?? [];
  if (variantKeys.length === 0) {
    return undefined;
  }
  return {
    ...(reasoningConfig?.defaultVariant ? { defaultLevel: reasoningConfig.defaultVariant } : {}),
    levels: Object.fromEntries(variantKeys.map((level) => [level, {}])),
  };
}

function openCodeModelToModelProviderModel(
  modelId: string,
  model: CfOpenCodeModelConfig,
  providerDefaultKind: ModelProviderKind,
  options: { preferOpenCodeFields: boolean },
): ModelProviderModelConfig {
  const cf = options.preferOpenCodeFields ? undefined : model.cf;
  const cfExtensions = model.cf;
  const contextWindow =
    readPositiveNumber(model.limit?.context) ?? readPositiveNumber(model.contextWindow);
  const maxOutputTokens =
    readPositiveNumber(model.limit?.output) ??
    readPositiveNumber(model.options?.max_tokens) ??
    readPositiveNumber(model.maxOutputTokens);
  const hasMaxOutputTokens =
    (!options.preferOpenCodeFields ? model.hasMaxOutputTokens : undefined) ??
    cf?.hasMaxOutputTokens ??
    maxOutputTokens !== undefined;
  const kinds =
    !options.preferOpenCodeFields && model.kinds?.length
      ? model.kinds
      : cf?.kinds?.length
        ? cf.kinds
        : [providerDefaultKind];
  return createModelProviderModelConfig({
    id: model.id?.trim() || modelId,
    name: model.name,
    kinds,
    defaultKind:
      (!options.preferOpenCodeFields ? model.defaultKind : undefined) ??
      cf?.defaultKind ??
      providerDefaultKind,
    contextWindow,
    maxOutputTokens: hasMaxOutputTokens ? maxOutputTokens : undefined,
    modalities: {
      input: model.modalities?.input,
      output: model.modalities?.output,
    },
    reasoning: openCodeReasoningToModelReasoning(model, options),
    priority: readFiniteNumber(model.priority) ?? readFiniteNumber(cfExtensions?.priority),
    disabledReason: model.disabledReason ?? cf?.disabledReason,
    supportsTools: model.supportsTools ?? cf?.supportsTools,
    supportsStructuredOutput: model.supportsStructuredOutput ?? cf?.supportsStructuredOutput,
    modified: model.modified ?? cfExtensions?.modified,
    deleted: model.deleted ?? cfExtensions?.deleted,
  });
}

function normalizeDeletedModelIds(modelIds: readonly string[] | undefined): string[] {
  const deletedModels: string[] = [];
  const seen = new Set<string>();
  for (const rawModelId of modelIds ?? []) {
    const modelId = rawModelId.trim();
    const key = modelId.toLowerCase();
    if (!modelId || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deletedModels.push(modelId);
  }
  return deletedModels;
}

function createDeletedModelTombstone(
  modelId: string,
  providerDefaultKind: ModelProviderKind,
): ModelProviderModelConfig {
  return createModelProviderModelConfig({
    id: modelId,
    kinds: [providerDefaultKind],
    contextWindow: LEGACY_FALLBACK_CONTEXT_WINDOW,
    modalities: { input: ["text"], output: ["text"] },
    modified: true,
    deleted: true,
  });
}

function openCodeProviderToModelProviderConfig(
  providerId: string,
  provider: CfOpenCodeProviderConfig,
): ModelProviderConfig {
  const cf = provider.cf;
  const preferOpenCodeFields = hasOpenCodeProviderRuntimeFields(provider);
  const configuredDefaultKind = resolveOpenCodeProviderDefaultKind(provider);
  const options = provider.options ?? {};
  const configuredRuntimeBaseURL = readString(options.baseURL) ?? readString(provider.api);
  const defaultKind =
    resolvePresetProviderKindFromRuntimeBaseUrl(providerId, configuredRuntimeBaseURL) ??
    configuredDefaultKind;
  const endpoints = resolveOpenCodeProviderEndpoints(provider, defaultKind, providerId);
  const apiKey = readString(options.apiKey) ?? "";
  const now = Date.now();
  const models = Object.entries(provider.models ?? {}).map(([modelId, model]) =>
    openCodeModelToModelProviderModel(modelId, model, defaultKind, {
      preferOpenCodeFields,
    }),
  );
  const modelKeys = new Set(models.map((model) => model.id.trim().toLowerCase()).filter(Boolean));
  for (const deletedModelId of normalizeDeletedModelIds(cf?.deletedModels)) {
    const key = deletedModelId.toLowerCase();
    if (modelKeys.has(key)) {
      continue;
    }
    models.push(createDeletedModelTombstone(deletedModelId, defaultKind));
    modelKeys.add(key);
  }
  const apiKeyRequired =
    provider.apiKeyRequired ?? cf?.apiKeyRequired ?? readBoolean(options.apiKeyRequired);
  const providerMappings = preferOpenCodeFields
    ? undefined
    : stripCfPrefixedProviderMappings(provider.providerMappings ?? cf?.providerMappings);
  return normalizeProviderForStore({
    id: provider.id?.trim() || providerId,
    name: provider.name?.trim() || providerId,
    ...(provider.enabled !== undefined
      ? { enabled: provider.enabled }
      : cf?.enabled !== undefined
        ? { enabled: cf.enabled }
        : {}),
    ...((provider.systemDisabledReason ?? cf?.systemDisabledReason)
      ? {
          systemDisabledReason: provider.systemDisabledReason ?? cf?.systemDisabledReason,
        }
      : {}),
    endpoints,
    apiFormat: preferOpenCodeFields
      ? resolveModelProviderKindApiFormat(defaultKind)
      : (provider.apiFormat ?? cf?.apiFormat ?? resolveModelProviderKindApiFormat(defaultKind)),
    ...((provider.source ?? cf?.source)
      ? { source: provider.source ?? cf?.source }
      : { source: "custom" }),
    ...((provider.catalogSourceId ?? cf?.catalogSourceId)
      ? { catalogSourceId: provider.catalogSourceId ?? cf?.catalogSourceId }
      : {}),
    ...((provider.catalogProviderId ?? cf?.catalogProviderId)
      ? {
          catalogProviderId: provider.catalogProviderId ?? cf?.catalogProviderId,
        }
      : {}),
    ...((provider.modelsDevProviderId ?? cf?.modelsDevProviderId)
      ? {
          modelsDevProviderId: provider.modelsDevProviderId ?? cf?.modelsDevProviderId,
        }
      : {}),
    ...(apiKeyRequired !== undefined ? { apiKeyRequired } : {}),
    ...((provider.headers ?? cf?.headers ?? readStringRecord(options.headers))
      ? {
          headers: provider.headers ?? cf?.headers ?? readStringRecord(options.headers),
        }
      : {}),
    ...((provider.logoUrl ?? cf?.logoUrl)
      ? { logoUrl: provider.logoUrl ?? cf?.logoUrl }
      : {}),
    apiKey,
    ...((provider.apiKeyUrl ?? cf?.apiKeyUrl)
      ? { apiKeyUrl: provider.apiKeyUrl ?? cf?.apiKeyUrl }
      : {}),
    defaultKind,
    models,
    ...(providerMappings ? { providerMappings } : {}),
    createdAt:
      (!preferOpenCodeFields ? (provider.createdAt ?? cf?.createdAt) : undefined) ?? now,
    updatedAt:
      (!preferOpenCodeFields ? (provider.updatedAt ?? cf?.updatedAt) : undefined) ?? now,
  });
}

async function readRawCfConfigFile(): Promise<CfConfigFile | null> {
  const filePath = getCfConfigFilePath();
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw new Error(`Old Provider ConfigurationReadFailed stage=io path=${filePath} code=${code ?? "unknown"}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Old Provider Configuration解析Failed stage=json path=${filePath}`);
  }
  const parsed = cfConfigFileSchema.safeParse(json);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.map(String).join(".").slice(0, 256) ?? "";
    throw new Error(`Old Provider Configuration校验Failed stage=schema path=${filePath} field=${field}`);
  }
  return parsed.data;
}

async function readCfConfigProviders(): Promise<ModelProviderConfig[] | null> {
  const config = await readRawCfConfigFile();
  if (!config?.provider) {
    return null;
  }
  const providers = Object.entries(config.provider).map(([providerId, provider]) =>
    openCodeProviderToModelProviderConfig(providerId, provider),
  );
  return applyProviderStoreMigrations(providers);
}

function normalizeModelKindsFromProvider(
  provider: Pick<
    ModelProviderConfig,
    "apiFormat" | "defaultKind" | "endpoints" | "modelSupportedFormats"
  >,
  modelId: string,
): ModelProviderKind[] {
  const formats =
    provider.modelSupportedFormats?.[modelId] ??
    (provider.apiFormat
      ? getDefaultModelSupportedFormatsFromApiFormat(provider.apiFormat)
      : getDefaultModelSupportedFormatsFromEndpoints(provider.endpoints));
  const kinds = formats.flatMap((format) => {
    const kind = mapModelProviderSupportedFormatToKind(format);
    return kind ? [kind] : [];
  });
  if (kinds.length > 0) {
    return [...new Set(kinds)];
  }

  const defaultKind = resolveModelProviderDefaultKind(provider);
  return defaultKind ? [defaultKind] : [];
}

function normalizeModelProviderModelConfigEntry(
  model: ModelProviderModelConfig,
): ModelProviderModelConfig | null {
  const id = model.id.trim();
  if (!id) {
    return null;
  }

  return {
    ...model,
    id,
    name: model.name?.trim() || undefined,
    contextWindow: resolveModelProviderContextWindow(model.contextWindow),
    kinds: [...new Set(model.kinds)],
    modalities: {
      input: [...new Set(model.modalities.input)],
      output: [...new Set(model.modalities.output)],
    },
  };
}

function normalizeProviderModels(provider: ModelProviderConfig): ModelProviderModelConfig[] {
  const hasModelConfigs = provider.models.some(isModelProviderModelConfig);
  if (hasModelConfigs) {
    const seen = new Set<string>();
    return provider.models.flatMap((rawModel) => {
      const rawModelId = isModelProviderModelConfig(rawModel) ? rawModel.id : rawModel;
      const modelId = rawModelId.trim();
      if (!modelId) {
        return [];
      }

      const normalizedModel = isModelProviderModelConfig(rawModel)
        ? normalizeModelProviderModelConfigEntry(rawModel)
        : createModelProviderModelConfig({
            id: modelId,
            name: provider.modelDisplayNames?.[modelId],
            kinds: normalizeModelKindsFromProvider(provider, modelId),
            defaultKind: resolveModelProviderDefaultKind(provider),
          });
      if (!normalizedModel || seen.has(normalizedModel.id)) {
        return [];
      }

      seen.add(normalizedModel.id);
      return [normalizedModel];
    });
  }

  const migrated = legacyModelProviderListSchema.safeParse([provider]);
  if (migrated.success) {
    return migrateLegacyModelProviderConfig(migrated.data[0]!).models.filter(
      isModelProviderModelConfig,
    );
  }

  const seen = new Set<string>();
  return getModelProviderModelIds(provider).flatMap((modelId) => {
    if (seen.has(modelId)) {
      return [];
    }
    seen.add(modelId);
    return [
      createModelProviderModelConfig({
        id: modelId,
        name: provider.modelDisplayNames?.[modelId],
        kinds: normalizeModelKindsFromProvider(provider, modelId),
        defaultKind: resolveModelProviderDefaultKind(provider),
      }),
    ];
  });
}

function hasCanonicalEndpoints(endpoints: ModelProviderEndpoints): boolean {
  return Boolean(endpoints.baseURL?.trim() || endpoints.paths);
}

function resolveProviderDefaultKindForStore(provider: ModelProviderConfig): ModelProviderKind {
  if (provider.defaultKind || provider.apiFormat || hasCanonicalEndpoints(provider.endpoints)) {
    return resolveModelProviderDefaultKind(provider);
  }

  if (provider.endpoints.anthropic?.trim()) {
    return "anthropic";
  }
  if (provider.endpoints.openai?.trim()) {
    return "openai-compatible";
  }
  return resolveModelProviderDefaultKind(provider);
}

function normalizeProviderForStore(provider: ModelProviderConfig): ModelProviderConfig {
  const defaultKind = resolveProviderDefaultKindForStore(provider);
  const normalizedEndpoints = normalizeEndpoints(provider.endpoints, defaultKind);
  const apiFormat = resolveModelProviderApiFormat({
    apiFormat: provider.apiFormat,
    defaultKind,
    endpoints: normalizedEndpoints,
  });
  const normalizedModels = normalizeProviderModels({
    ...provider,
    apiFormat,
    defaultKind,
    endpoints: normalizedEndpoints,
    modelSupportedFormats: provider.modelSupportedFormats,
  });

  return {
    ...provider,
    apiFormat,
    defaultKind,
    endpoints: normalizedEndpoints,
    models: normalizedModels,
    modelDisplayNames: undefined,
    modelSupportedFormats: undefined,
    providerMappings: stripCfPrefixedProviderMappings(
      stripLegacyClaudeProviderMappings(provider.providerMappings),
    ),
  };
}

function applyProviderStoreMigrations(providers: ModelProviderConfig[]): ModelProviderConfig[] {
  let next = providers.filter(
    (provider) =>
      provider.id !== RETIRED_ZAPI_PROVIDER_ID &&
      !(provider.id.startsWith("default-") && provider.apiKey.trim().length === 0),
  );

  return next.map(normalizeProviderForStore);
}

export async function readLegacyCfConfigProviders(): Promise<ModelProviderConfig[]> {
  const configProviders = await readCfConfigProviders();
  return configProviders ? filterDeletedProviderModelsForRead(configProviders) : [];
}

function filterDeletedProviderModelsForRead(
  providers: ModelProviderConfig[],
): ModelProviderConfig[] {
  return providers.map((provider) => ({
    ...provider,
    models: provider.models.filter(
      (model) => !isModelProviderModelConfig(model) || model.deleted !== true,
    ),
  }));
}

function resolveLegacyRuntimeBaseUrlForKind(
  endpoints: ModelProviderEndpoints,
  defaultKind: ModelProviderKind,
): string {
  const rawEndpoint =
    defaultKind === "anthropic" ? endpoints.anthropic?.trim() : endpoints.openai?.trim();
  if (rawEndpoint) {
    return normalizeModelProviderBaseUrlForKind(rawEndpoint, defaultKind);
  }
  const fallbackEndpoint = endpoints.anthropic?.trim() || endpoints.openai?.trim() || "";
  return fallbackEndpoint
    ? normalizeModelProviderBaseUrlForKind(fallbackEndpoint, defaultKind)
    : "";
}

function resolveRuntimeBaseUrlForStore(
  endpoints: ModelProviderEndpoints,
  defaultKind: ModelProviderKind,
): string {
  const runtimeBaseURL = resolveModelProviderRuntimeBaseUrl(
    {
      apiFormat: resolveModelProviderKindApiFormat(defaultKind),
      defaultKind,
      endpoints,
    },
    defaultKind,
  );
  if (runtimeBaseURL) {
    return runtimeBaseURL;
  }

  const baseURL = endpoints.baseURL?.trim();
  if (baseURL) {
    return normalizeModelProviderBaseUrlForKind(baseURL, defaultKind);
  }

  return resolveLegacyRuntimeBaseUrlForKind(endpoints, defaultKind);
}

function normalizeEndpoints(
  endpoints: ModelProviderEndpoints,
  defaultKind: ModelProviderKind,
): ModelProviderEndpoints {
  const runtimeBaseURL = resolveRuntimeBaseUrlForStore(endpoints, defaultKind);
  if (!runtimeBaseURL) {
    return {};
  }
  return {
    baseURL: runtimeBaseURL,
    paths: {
      [defaultKind]: getDefaultModelProviderEndpointPathForKind(defaultKind),
    },
  };
}
