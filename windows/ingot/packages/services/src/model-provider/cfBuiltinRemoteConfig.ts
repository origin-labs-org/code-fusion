import { downloadCfBuiltinRelease, type CfBuiltinRelease } from "@origin-ai/cf-provider-node";
import type { ApiClient } from "@origin-ai/cf-shared";

export interface FetchCfBuiltinRemoteReleaseOptions {
  readonly apiClient: ApiClient;
  readonly endpointOrigin: string;
  readonly appVersion: string;
  readonly platform: string;
  readonly signal?: AbortSignal;
}

export async function fetchCfBuiltinRemoteRelease(
  options: FetchCfBuiltinRemoteReleaseOptions,
): Promise<CfBuiltinRelease | null> {
  return downloadCfBuiltinRelease({
    endpointOrigin: options.endpointOrigin,
    appVersion: options.appVersion,
    platform: options.platform,
    signal: options.signal,
    request: (url, init) => options.apiClient.request(url, init),
  });
}
