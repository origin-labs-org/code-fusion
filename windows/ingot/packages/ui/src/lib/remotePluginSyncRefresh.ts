import type {
  ICommandsService,
  IMcpSyncService,
  ISkillsService,
  ICfAgentService,
} from "@origin-ai/cf-services";
import { logger } from "@/logger.js";
import { invalidateDeferredDraftSessionForSkillChange } from "@/lib/cfDraftSkillInvalidation.js";
import { refreshSharedSkillStoreForWorkspace } from "@/lib/skillStoreRefresh.js";
import { mergeSlashCommandsAfterCommandRefresh } from "@/settings/pluginSlashCommandRefresh.js";
import { useCommandsStore } from "@/store/commandsStore.js";
import { useMcpStore } from "@/store/mcpStore.js";
import { notifyPluginManagementChange } from "@/store/pluginManagementStoreLoading.js";
import { useCfSessionStore } from "@/store/cfSessionStore.js";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function refreshSlashCommandsAfterRemotePluginSync(params: {
  commandsService: ICommandsService;
  reason: string;
  workspacePath: string;
  workspaceIdentity: string | null;
}): Promise<void> {
  const { commandsService, reason, workspacePath, workspaceIdentity } = params;
  const workspaceIdentityParam = workspaceIdentity ?? undefined;

  try {
    const result = await commandsService.list({
      workspacePath,
      ...(workspaceIdentityParam ? { workspaceIdentity: workspaceIdentityParam } : {}),
    });

    const commandsStore = useCommandsStore.getState();
    if (
      commandsStore.workspacePath === workspacePath &&
      commandsStore.workspaceIdentity === workspaceIdentity
    ) {
      useCommandsStore.setState({
        commands: result.commands,
        userCommands: result.userCommands,
        pluginCommands: result.pluginCommands,
        capability: result.capability,
        loadedWorkspacePath: workspacePath,
        loadedWorkspaceIdentity: workspaceIdentity,
        loading: false,
        error: null,
      });
    }

    const cfSessionStore = useCfSessionStore.getState();
    const currentSlashCommands = cfSessionStore.getWorkspaceState(
      workspacePath,
      workspaceIdentityParam,
    ).slashCommands;
    cfSessionStore.setSlashCommands(
      workspacePath,
      mergeSlashCommandsAfterCommandRefresh(currentSlashCommands, result.commands),
      workspaceIdentityParam,
    );
  } catch (error) {
    const commandsStore = useCommandsStore.getState();
    if (
      commandsStore.workspacePath === workspacePath &&
      commandsStore.workspaceIdentity === workspaceIdentity
    ) {
      useCommandsStore.setState({
        loading: false,
        error: toMessage(error),
      });
    }
    logger.warn("[plugins] refresh slash commands after remote plugin sync failed", {
      reason,
      workspaceIdentity,
      workspacePath,
      error: toMessage(error),
    });
  }
}

export async function refreshWorkspacePluginCapabilitiesAfterRemoteSync(params: {
  commandsService: ICommandsService;
  mcpSyncService: IMcpSyncService;
  reason: string;
  skillsService: ISkillsService;
  workspaceIdentity?: string | null;
  workspacePath?: string | null;
  cfAgentService: ICfAgentService;
}): Promise<void> {
  const workspacePath = params.workspacePath;
  if (!workspacePath) {
    return;
  }
  const workspaceIdentity = params.workspaceIdentity?.trim() || null;
  const workspaceIdentityParam = workspaceIdentity ?? undefined;
  await invalidateDeferredDraftSessionForSkillChange({
    workspacePath,
    workspaceIdentity: workspaceIdentityParam,
    reason: params.reason,
  });
  await refreshSharedSkillStoreForWorkspace({
    workspacePath,
    workspaceIdentity: workspaceIdentityParam,
    skillsService: params.skillsService,
  });
  await refreshSlashCommandsAfterRemotePluginSync({
    commandsService: params.commandsService,
    reason: params.reason,
    workspacePath,
    workspaceIdentity,
  });
  await useMcpStore
    .getState()
    .ensureLoadedForWorkspace(workspacePath, params.mcpSyncService, workspaceIdentityParam);
  notifyPluginManagementChange({
    workspacePath,
    workspaceIdentity,
    authorityKey: null,
    scope: "user",
  });
}
