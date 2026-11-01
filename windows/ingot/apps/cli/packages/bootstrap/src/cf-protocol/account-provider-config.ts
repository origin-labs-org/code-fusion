import {
  cfProviderRefreshRegistryParamsSchema,
  cfProviderUpdateAccountConfigParamsSchema,
  type CfProviderRefreshRegistryResult,
  type CfProviderUpdateAccountConfigResult,
} from "@origin-ai/cf-shared";
import { parseProcessAccountProviderConfigSnapshot } from "../app/process-provider-registry-runtime.js";
import {
  parseParams,
  ProtocolRequestError,
  type CfProtocolAgentServerContext,
} from "./server-types.js";

export async function updateAccountProviderConfig(
  context: CfProtocolAgentServerContext,
  params: unknown,
): Promise<CfProviderUpdateAccountConfigResult> {
  const envelope = parseParams(cfProviderUpdateAccountConfigParamsSchema, params);
  const snapshot = parseProcessAccountProviderConfigSnapshot(envelope);
  if (!context.deps.syncAccountProviderConfig) {
    throw new ProtocolRequestError(-32018, "Account Provider Config runtime is not configured");
  }
  const changed = await context.deps.syncAccountProviderConfig(snapshot);
  return {
    receivedRevision: snapshot.revision,
    providerCount: snapshot.providers.keys().length,
    status: changed ? "received" : "unchanged",
  };
}

export async function refreshProviderRegistry(
  context: CfProtocolAgentServerContext,
  params: unknown,
): Promise<CfProviderRefreshRegistryResult> {
  const envelope = cfProviderRefreshRegistryParamsSchema.parse(params);
  if (!context.deps.refreshProviderRegistry) {
    throw new ProtocolRequestError(-32019, "Provider Registry refresh is not configured");
  }
  await context.deps.refreshProviderRegistry(envelope.reason);
  return { refreshed: true };
}
