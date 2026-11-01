
import type { ICfSessionService } from "@origin-ai/cf-services";
import { type CfProvider, type CfWorkspacePrepareResult } from "@origin-ai/cf-shared";
import { getChatErrorMessage } from "@/lib/chatPrepareError.js";
import { logger } from "@/logger.js";
import { cfWorkspacePresentationToConfigOptions } from "@/lib/cfSessionProjection.js";

export async function prepareWorkspaceWithCfSessionService(params: {
  workspacePath: string;
  workspaceIdentity?: string;
  provider: CfProvider;
  cfSessionService: Pick<ICfSessionService, "readWorkspacePresentation">;
}): Promise<CfWorkspacePrepareResult> {
  const startedAt = Date.now();
  logger.info("[cf-workspace-presentation] workspace prepare start", {
    workspacePath: params.workspacePath,
    workspaceIdentity: params.workspaceIdentity ?? null,
    provider: params.provider,
  });

  let presentation: Awaited<ReturnType<ICfSessionService["readWorkspacePresentation"]>>;
  try {
    presentation = await params.cfSessionService.readWorkspacePresentation({
      workspacePath: params.workspacePath,
      workspaceIdentity: params.workspaceIdentity,
    });
  } catch (error) {
    logger.warn("[cf-workspace-presentation] readWorkspacePresentation failed", {
      workspacePath: params.workspacePath,
      workspaceIdentity: params.workspaceIdentity ?? null,
      provider: params.provider,
      durationMs: Date.now() - startedAt,
      error: getChatErrorMessage(error),
    });
    throw error;
  }

  const readPresentationDurationMs = Date.now() - startedAt;
  const configOptions = cfWorkspacePresentationToConfigOptions(presentation.mode);
  const totalDurationMs = Date.now() - startedAt;
  logger.info("[cf-workspace-presentation] readWorkspacePresentation done", {
    workspacePath: params.workspacePath,
    workspaceIdentity: params.workspaceIdentity ?? null,
    provider: params.provider,
    readPresentationDurationMs,
    totalDurationMs,
    configOptionsCount: configOptions.length,
    modeCurrent: presentation.mode,
  });

  return {
    workspacePath: params.workspacePath,
    preparedSessionId: "",
    version: "CodeFusion Protocol/1",
    provider: params.provider,
    configOptions,
    slashCommands: presentation.slashCommands,
  };
}
