import { DEFAULT_CF_ENDPOINT_ORIGIN } from "./cfEndpoint.js";

export const CF_SOURCE_HEADERS = {
  "User-Agent": "CodeFusion/unknown",
  "HTTP-Referer": DEFAULT_CF_ENDPOINT_ORIGIN,
  "X-Title": "Z Code@electron",
} as const;

export interface BuildCfSourceHeadersFromContextOptions {
  appVersion?: string;
  arch?: string;
  clientLanguage?: string;
  clientTimezone?: string;
  deviceMid?: string;
  endpointOrigin?: string;
  osVersion?: string;
  platform?: string;
  releaseChannel?: string;
  sourceTitle?: string;
}

export function normalizeCfSourceHeaderValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^[\x20-\x7e]+$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function buildCfSourceHeadersFromContext(
  options: BuildCfSourceHeadersFromContextOptions = {},
): Record<string, string> {
  const appVersion = normalizeCfSourceHeaderValue(options.appVersion);
  const arch = normalizeCfSourceHeaderValue(options.arch);
  const clientLanguage = normalizeCfSourceHeaderValue(options.clientLanguage) ?? "unknown";
  const clientTimezone = normalizeCfSourceHeaderValue(options.clientTimezone) ?? "unknown";
  const deviceMid = normalizeCfSourceHeaderValue(options.deviceMid);
  const endpointOrigin =
    normalizeCfSourceHeaderValue(options.endpointOrigin) ?? DEFAULT_CF_ENDPOINT_ORIGIN;
  const osVersion = normalizeCfSourceHeaderValue(options.osVersion);
  const platform = normalizeCfSourceHeaderValue(options.platform);
  const releaseChannel = normalizeCfSourceHeaderValue(options.releaseChannel);
  const sourceTitle = normalizeCfSourceHeaderValue(options.sourceTitle) ?? "electron";

  return {
    ...CF_SOURCE_HEADERS,
    "HTTP-Referer": endpointOrigin,
    "User-Agent": `CodeFusion/${appVersion ?? "unknown"}`,
    ...(appVersion ? { "X-CodeFusion-App-Version": appVersion } : {}),
    "X-Title": `Z Code@${sourceTitle}`,
    ...(platform && arch ? { "X-Platform": `${platform}-${arch}` } : {}),
    ...(releaseChannel ? { "X-Release-Channel": releaseChannel } : {}),
    "X-Client-Language": clientLanguage,
    "X-Client-Timezone": clientTimezone,
    ...(platform ? { "X-Os-Category": normalizeOsCategory(platform) } : {}),
    ...(osVersion ? { "X-Os-Version": osVersion } : {}),
    ...(deviceMid ? { "X-Device-Mid": deviceMid } : {}),
  };
}

function normalizeOsCategory(platform: string): string {
  switch (platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return "linux";
  }
}
