import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  providerProvisioningEnvelopeSchema,
  type ProviderProvisioningCredentialEntry,
  type ProviderProvisioningEnvelope,
} from "@origin-ai/cf-shared";
import type {
  PersonalProviderConfigRepository,
  ProviderConfigLayerSnapshot,
} from "@origin-ai/cf-provider";
import { decodeProviderConfigFile, encodeProviderConfigFile } from "@origin-ai/cf-provider-node";
import {
  createCredentialCipherProvider,
  type CredentialCipherProvider,
} from "../credential/providers/credentialCipherProvider.js";
import type { ISettingService } from "../setting/setting.js";

const CREDENTIAL_FILE_NAME = "credentials.json";
export const PROVIDER_PROVISIONING_OAUTH_CREDENTIAL_KEYS = [
  "oauth:active_provider",
  "oauth:zai:access_token",
  "oauth:zai:refresh_token",
  "oauth:zai:user_info",
  "oauth:bigmodel:access_token",
  "oauth:bigmodel:refresh_token",
  "oauth:bigmodel:user_info",
  "cfjwttoken",
] as const;

export interface ProviderProvisioningSource {
  read(syncId: string): Promise<ProviderProvisioningEnvelope>;
}

export interface ProviderProvisioningSourceOptions {
  readonly personalRepository: PersonalProviderConfigRepository;
  readonly settingService: ISettingService;
  readonly credentialFilePath: string;
  readonly personalConfigFilePath: string;
  readonly cipherProvider?: CredentialCipherProvider;
}

export function createProviderProvisioningSource(
  options: ProviderProvisioningSourceOptions,
): ProviderProvisioningSource {
  return {
    async read(syncId: string): Promise<ProviderProvisioningEnvelope> {
      const [personal, settings, credentials] = await Promise.all([
        readProvisionablePersonalConfig(options.personalRepository, options.personalConfigFilePath),
        options.settingService.get(),
        readProvisioningCredentials(options.credentialFilePath, options.cipherProvider),
      ]);
      const personalConfig = encodeProviderConfigFile(personal).config;
      const accountSettings = {
        providerFamilyDomain: settings.providerFamilyDomain ?? null,
        providerFamilyConnectionSelections: settings.providerFamilyConnectionSelections ?? {},
      };
      return providerProvisioningEnvelopeSchema.parse({
        schemaVersion: 2,
        syncId,
        personalConfig,
        accountSettings,
        credentials,
      });
    },
  };
}

export async function readProvisionablePersonalConfig(
  repository: PersonalProviderConfigRepository,
  filePath: string,
): Promise<ProviderConfigLayerSnapshot> {
  const personal = await repository.read();
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (isFileNotFound(error)) {
      const rules = personal.models.toPersonalJSON();
      if (
        personal.providers.keys().length === 0 &&
        rules.providerModelRules.length === 0 &&
        rules.manualProviderModelRules.length === 0 &&
        !personal.providerOrder?.length &&
        personal.defaultModelSelection === undefined
      )
        return personal;
    }
    throw new Error(`Local Personal Provider Config Unable to sync.: ${filePath}`, { cause: error });
  }
  try {
    const decoded = decodeProviderConfigFile(JSON.parse(raw) as unknown);
    const actualRevision = createHash("sha256")
      .update(JSON.stringify(encodeProviderConfigFile(decoded)))
      .digest("hex");
    if (actualRevision !== personal.revision) {
      throw new Error("Personal Provider Config 在读取期间发生变化");
    }
    return personal;
  } catch (error) {
    throw new Error(`Local Personal Provider Config Unable to sync.: ${filePath}`, { cause: error });
  }
}

async function readProvisioningCredentials(
  credentialFilePath: string,
  cipherProvider?: CredentialCipherProvider,
): Promise<ProviderProvisioningCredentialEntry[]> {
  let raw: string;
  try {
    raw = await readFile(credentialFilePath, "utf8");
  } catch (error) {
    if (isFileNotFound(error)) return [];
    throw error;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Credential Store 必须是 JSON 对象");
  }
  const cipher = cipherProvider ?? createCredentialCipherProvider();
  const allowedKeys = new Set<string>(PROVIDER_PROVISIONING_OAUTH_CREDENTIAL_KEYS);
  const entries: ProviderProvisioningCredentialEntry[] = [];
  for (const [key, encrypted] of Object.entries(parsed)) {
    if (!allowedKeys.has(key)) continue;
    if (typeof encrypted !== "string") {
      throw new Error(`Credential allowlist value must be a string: ${key}`);
    }
    const value = cipher.decrypt(encrypted);
    if (!value.trim()) continue;
    entries.push({ scope: "oauth-session", key, value });
  }
  return entries;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

export function resolveCredentialFilePath(appConfigDir: string): string {
  return join(appConfigDir, CREDENTIAL_FILE_NAME);
}

export async function listProviderProvisioningCredentialKeys(
  credentialFilePath: string,
): Promise<readonly string[]> {
  let raw: string;
  try {
    raw = await readFile(credentialFilePath, "utf8");
  } catch (error) {
    if (isFileNotFound(error)) return [];
    throw error;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) throw new Error("Credential Store 必须是 JSON 对象");
  const oauthKeys = new Set<string>(PROVIDER_PROVISIONING_OAUTH_CREDENTIAL_KEYS);
  return Object.keys(parsed).filter((key) => oauthKeys.has(key));
}
