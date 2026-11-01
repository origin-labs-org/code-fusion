import { cfWorkspaceUpdateInteractionPreferencesParamsSchema } from "@origin-ai/cf-shared";
import { parseParams, type CfProtocolAgentServerContext } from "./server-types.js";

export async function updateInteractionPreferences(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
) {
  const params = parseParams(cfWorkspaceUpdateInteractionPreferencesParamsSchema, rawParams);
  const enabled = params.preferences.askUserQuestionAutoResolutionEnabled;
  context.appRuntimePreferences.askUserQuestionAutoResolutionEnabled = enabled;
  const snoozedInteractionCount =
    await context.v4Interactions.setAskUserQuestionAutoResolutionEnabled(enabled);

  return {
    workspace: params.workspace,
    askUserQuestionAutoResolutionEnabled: enabled,
    snoozedInteractionCount,
  };
}
