import { readFile } from "node:fs/promises";
import { arch as readOsArch, homedir, release as readOsRelease } from "node:os";
import { join } from "node:path";
import {
  buildCfSourceHeadersFromContext,
  resolveRuntimeCfEndpointOrigin,
  resolveRuntimeCfEnv,
  CF_APP_VERSION_ENV,
} from "@origin-ai/cf-shared";
import type { ModelProviderSourceTitle } from "./model-config.js";

const CF_DATA_BASE_DIR_ENV_KEY = "CF_DATA_BASE_DIR";
const cachedDeviceMidByStateFile = new Map<string, string>();

interface CreateProviderEndpointRoutingSourceHeadersOptions {
  appVersion?: string;
  env?: NodeJS.ProcessEnv;
  sourceTitle?: ModelProviderSourceTitle;
}

export async function createProviderEndpointRoutingSourceHeaders(
  options: CreateProviderEndpointRoutingSourceHeadersOptions = {},
): Promise<Record<string, string>> {
  const env = options.env ?? process.env;
  const deviceMid = await readExistingDeviceMid(resolveTelemetryStateFile(env));
  return buildCfSourceHeadersFromContext({
    appVersion: env[CF_APP_VERSION_ENV] ?? options.appVersion,
    arch: readOsArch(),
    clientLanguage: resolveClientLanguage(),
    clientTimezone: resolveClientTimezone(),
    deviceMid,
    endpointOrigin: resolveRuntimeCfEndpointOrigin(env),
    osVersion: readOsRelease(),
    platform: process.platform,
    releaseChannel: resolveRuntimeCfEnv(env),
    sourceTitle: options.sourceTitle ?? "cli",
  });
}

function resolveClientLanguage(): string {
  return Intl.DateTimeFormat().resolvedOptions().locale;
}

function resolveClientTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function resolveTelemetryStateFile(env: NodeJS.ProcessEnv): string {
  const dataBaseDir = env[CF_DATA_BASE_DIR_ENV_KEY]?.trim() || homedir();
  return join(dataBaseDir, ".cf", "v2", "telemetry-state.json");
}

async function readExistingDeviceMid(
  stateFile: string,
): Promise<string | undefined> {
  const cached = cachedDeviceMidByStateFile.get(stateFile);
  if (cached) {
    return cached;
  }

  try {
    const parsed = JSON.parse(await readFile(stateFile, "utf8")) as {
      deviceMid?: unknown;
    };
    if (typeof parsed.deviceMid !== "string") {
      return undefined;
    }

    const deviceMid = parsed.deviceMid.trim();
    if (!deviceMid || !/^[\x20-\x7e]+$/.test(deviceMid)) {
      return undefined;
    }

    cachedDeviceMidByStateFile.set(stateFile, deviceMid);
    return deviceMid;
  } catch {
    return undefined;
  }
}
