import { cfWorkspaceUpdateOffPeakToolPolicyParamsSchema } from "@origin-ai/cf-shared";
import { parseParams, type CfProtocolAgentServerContext } from "./server-types.js";

export async function updateOffPeakToolPolicy(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
) {
  const params = parseParams(cfWorkspaceUpdateOffPeakToolPolicyParamsSchema, rawParams);
  context.appRuntimePreferences.offPeakToolEnabled = params.enabled;
  return { workspace: params.workspace, enabled: params.enabled };
}
