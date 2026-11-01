import { getCfAgentModeSelectOptions, normalizeAvailableCfMode } from "@origin-ai/cf-shared";
import type { CfSessionSettingsState, CfSlashCommand } from "@origin-ai/cf-shared";
import type { WorkspaceConfigState } from "@origin-ai/cf-shared/cf-protocol-v4";
import { mapSessionSettings } from "./mapper.js";
import { listProtocolSlashCommands } from "./slash-commands.js";
import type { CfProtocolAgentServerContext } from "./server-types.js";

export function toV4WorkspaceConfigState(
  settings: CfSessionSettingsState,
  slashCommands: readonly CfSlashCommand[],
): WorkspaceConfigState {
  return {
    configOptions: [
      {
        id: "mode",
        name: "Mode",
        category: "mode",
        type: "select",
        currentValue: normalizeAvailableCfMode(settings.mode.current),
        options: getCfAgentModeSelectOptions(),
      },
    ],
    slashCommands: slashCommands.map((command) => ({
      name: command.name,
      description: command.description,
      ...(command.inputHint !== undefined ? { inputHint: command.inputHint } : {}),
      ...(command.source !== undefined ? { source: command.source } : {}),
    })),
  };
}

export async function buildLiveWorkspaceConfigStateV4(
  context: CfProtocolAgentServerContext,
  workspaceId: string,
): Promise<WorkspaceConfigState | null> {
  const record = Array.from(context.sessions.values()).find(
    (candidate) => candidate.workspace.workspaceKey === workspaceId,
  );
  if (!record) return null;
  const settings = await mapSessionSettings(record.app);
  const slashCommands = await listProtocolSlashCommands({
    dynamicWorkflowEnabled: context.appRuntimePreferences.dynamicWorkflowEnabled,
    env: context.deps.env,
    logger: context.logger,
    workingDirectory: record.workspace.workspacePath,
  });
  return toV4WorkspaceConfigState(settings, slashCommands);
}
