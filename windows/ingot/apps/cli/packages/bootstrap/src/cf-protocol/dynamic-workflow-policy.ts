import {
  cfWorkspaceUpdateDynamicWorkflowPolicyParamsSchema,
  type DynamicWorkflowMode,
} from "@origin-ai/cf-shared";
import { parseParams, type CfProtocolAgentServerContext } from "./server-types.js";

export async function updateDynamicWorkflowPolicy(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
) {
  const params = parseParams(cfWorkspaceUpdateDynamicWorkflowPolicyParamsSchema, rawParams);
  context.appRuntimePreferences.dynamicWorkflowEnabled = params.enabled;
  context.appRuntimePreferences.dynamicWorkflowMode = params.enabled ? params.mode : undefined;
  return { workspace: params.workspace, enabled: params.enabled };
}

export interface DynamicWorkflowRuntimeGate {
  dynamicWorkflowEnabled: boolean;
  dynamicWorkflowToolsOnDemand: boolean;
}

export function resolveDynamicWorkflowRuntimeGate(
  params: { dynamicWorkflowEnabled?: boolean; dynamicWorkflowMode?: DynamicWorkflowMode },
  preferences: { dynamicWorkflowEnabled: boolean; dynamicWorkflowMode?: DynamicWorkflowMode },
): DynamicWorkflowRuntimeGate {
  const enabled = params.dynamicWorkflowEnabled === true || preferences.dynamicWorkflowEnabled;
  if (!enabled) return { dynamicWorkflowEnabled: false, dynamicWorkflowToolsOnDemand: false };
  const mode = params.dynamicWorkflowMode ?? preferences.dynamicWorkflowMode ?? "alwaysOn";
  return { dynamicWorkflowEnabled: true, dynamicWorkflowToolsOnDemand: mode === "onDemand" };
}
