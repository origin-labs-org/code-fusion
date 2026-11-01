import { createLocalServices, type CfAgentCommandResolver } from "@origin-ai/cf-services/node";
import type { IChannel } from "@origin-ai/cf-rpc";
import {
  parseServiceAuthorityMode,
  CF_REMOTE_HTTP_PROXY_ENV_KEY,
  CF_REMOTE_NO_PROXY_ENV_KEY,
  CF_REMOTE_RUNTIME_NETWORK_AUTHORITY_ENV_KEY,
} from "@origin-ai/cf-shared";

export interface CreateStdioServicesOptions {
  topicResourceRelayChannel?: () => IChannel;
  env?: Record<string, string | undefined>;
  cfBuiltinProviderConfigFilePath: string;
  cfAgentCommandResolver?: CfAgentCommandResolver;
}

export interface RemoteAgentNetworkOptions {
  httpProxy?: string;
  noProxy?: string;
}

export function resolveRemoteAgentNetworkFromEnv(
  env: Record<string, string | undefined>,
): RemoteAgentNetworkOptions | undefined {
  if (env[CF_REMOTE_RUNTIME_NETWORK_AUTHORITY_ENV_KEY]?.trim() !== "1") {
    return undefined;
  }
  return {
    httpProxy: env[CF_REMOTE_HTTP_PROXY_ENV_KEY]?.trim() || undefined,
    noProxy: env[CF_REMOTE_NO_PROXY_ENV_KEY]?.trim() || undefined,
  };
}

export function createStdioServices(options: CreateStdioServicesOptions) {
  const env = options.env ?? process.env;
  const authorityModeParseResult = parseServiceAuthorityMode(env);
  const remoteAgentNetwork = resolveRemoteAgentNetworkFromEnv(env);
  const services = createLocalServices({
    cfBuiltinProviderConfigFilePath: options.cfBuiltinProviderConfigFilePath,
    topicResourceRelayChannel: options.topicResourceRelayChannel,
    serviceAuthorityMode: authorityModeParseResult.mode,
    cfAgentCommandResolver: options.cfAgentCommandResolver,
    remoteAgentNetwork,
  });

  return {
    authorityModeParseResult,
    services,
  };
}
