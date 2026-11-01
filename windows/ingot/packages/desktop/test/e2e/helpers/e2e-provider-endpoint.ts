import { requestSecurityEndpointEnv } from "./request-security-edition/index.js";

const LIVE_TEAM_SPEC = "conversation-session-r3-live-bigmodel-team.test.ts";
const LIVE_SHARE_SPEC = "conversation-session-share-ssh-artifact.test.ts";
const PRODUCTION_E2E_PROVIDER_CONFIG_ORIGIN = "https://cf.z.ai";

export function getE2EProviderEndpointEnv(
  specs: readonly string[],
  providerPreset: string,
  httpMode: string,
): Record<string, string> {
  if (!isProductionAccountRun(specs)) return requestSecurityEndpointEnv(providerPreset, httpMode);
  return {
    CF_BASE_URL: PRODUCTION_E2E_PROVIDER_CONFIG_ORIGIN,
    CF_ENDPOINT_ORIGIN: PRODUCTION_E2E_PROVIDER_CONFIG_ORIGIN,
    CF_ENV: "production",
    BIGMODEL_API_BASE_URL: "https://bigmodel.cn",
  };
}

export function shouldUseProductionE2EProviderEndpoint(
  specs: readonly string[],
  providerPreset: string,
  httpMode: string,
): boolean {
  return Object.keys(getE2EProviderEndpointEnv(specs, providerPreset, httpMode)).length > 0;
}

function isProductionAccountRun(specs: readonly string[]): boolean {
  const names = specs.map((spec) => spec.replaceAll("\\", "/").split("/").at(-1));
  const liveSpec = names.find((name) => name === LIVE_TEAM_SPEC || name === LIVE_SHARE_SPEC);
  if (!liveSpec) return false;
  if (!names.every((name) => name === liveSpec)) {
    throw new Error(
      `${liveSpec === LIVE_TEAM_SPEC ? "live-team" : "live-share"} 必须Run independently，不能与Other spec 共用生产控制面`,
    );
  }
  return true;
}
