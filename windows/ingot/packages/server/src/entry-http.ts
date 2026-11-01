import {
  createServerHostServices,
  createTopicResourcePeers,
  getAppConfigDir,
} from "@origin-ai/cf-services/node";
import {
  materializeBundledCfBuiltinProviderConfig,
  readBundledCfBuiltinProviderConfig,
} from "./bundledCfBuiltinProviderConfig.js";
import { createHttpServer, resolveHttpServerId } from "./http.js";

async function main(): Promise<void> {
  const cfBuiltinProviderConfigFilePath = await materializeBundledCfBuiltinProviderConfig({
    environmentConfigRoot: getAppConfigDir(),
    content: readBundledCfBuiltinProviderConfig(),
  });
  const port = Number(process.env["PORT"]) || 3030;
  const host = process.env["CF_SERVER_HOST"]?.trim() || process.env["HOST"]?.trim() || undefined;
  const staticRoot = process.env["CF_WEB_STATIC_ROOT"]?.trim() || undefined;
  const authToken = process.env["CF_SERVER_AUTH_TOKEN"]?.trim() || undefined;
  const topicResourcePeers = createTopicResourcePeers();
  const serverId = resolveHttpServerId();
  const { services, workspaceIdentityMapper, migrationFailedPathCount } =
    await createServerHostServices({
      topicResourceRelayChannel: (request) => topicResourcePeers.getChannel(request),
      sourceServerId: serverId,
      cfBuiltinProviderConfigFilePath,
      providerProvisioningTargetEnabled: Boolean(authToken),
    });

  createHttpServer(services, port, {
    serverId,
    workspaceIdentityMapper,
    migrationFailedPathCount,
    virtualProjects: true,
    topicResourcePeers,
    ...(host ? { host } : {}),
    ...(staticRoot ? { staticRoot, spaFallback: true } : {}),
    ...(authToken ? { authToken, authRequired: true } : {}),
  });
}

void main().catch((error: unknown) => {
  console.error("[cf-server:http] startup failed", error);
  process.exitCode = 1;
});
