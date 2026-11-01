import {
  DEFAULT_CF_ENDPOINT_ORIGIN,
  CF_VERSION,
  buildHelpAppConfigUrl,
  createHelpAppConfigReader,
  resolveHelpAppConfig,
  type Locale,
} from "@origin-ai/cf-shared";
import localDefaultAppConfig from "../../../config/default.json" with { type: "json" };

interface ResolveWebCommunityUrlOptions {
  fetchImpl?: typeof fetch;
  localConfig?: unknown;
  endpointOrigin?: string;
}

const readHelpConfig = createHelpAppConfigReader({
  fetchImpl: (input, init) => fetch(input, init),
});

export async function resolveWebHelpConfig(options: ResolveWebCommunityUrlOptions = {}) {
  const env = import.meta.env;
  const endpoint =
    options.endpointOrigin ??
    (env?.VITE_CF_BASE_URL?.trim() ||
      env?.VITE_CF_ENDPOINT_ORIGIN?.trim() ||
      DEFAULT_CF_ENDPOINT_ORIGIN);
  const url = buildHelpAppConfigUrl(endpoint, CF_VERSION);
  let remote: unknown;
  try {
    remote = await (
      options.fetchImpl
        ? createHelpAppConfigReader({ fetchImpl: options.fetchImpl })
        : readHelpConfig
    )(url);
  } catch {
  }
  return resolveHelpAppConfig(remote, options.localConfig ?? localDefaultAppConfig);
}

export async function resolveWebCommunityUrl(
  locale: Locale,
  options: ResolveWebCommunityUrlOptions = {},
): Promise<string | undefined> {
  return (await resolveWebHelpConfig(options)).community_urls?.[locale];
}
