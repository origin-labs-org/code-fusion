import type { CfAutomationBotDeliveryTarget } from "@origin-ai/cf-shared";

interface CronBotDeliveryRepo {
  getBotDeliveryTarget(
    automationId: string,
    workspaceKey?: string,
  ): Promise<CfAutomationBotDeliveryTarget | undefined>;
}

interface CronBotDeliveryService {
  watchAutomationRun(params: {
    target: CfAutomationBotDeliveryTarget;
    runId?: string;
    taskId: string;
    workspacePath: string;
    workspaceIdentity?: string;
  }): Promise<void>;
}

export async function watchCronRunBotDelivery(params: {
  automationId: string;
  runId?: string;
  workspaceKey: string;
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string;
  repo: CronBotDeliveryRepo;
  botsService: CronBotDeliveryService;
}): Promise<boolean> {
  const target = await params.repo.getBotDeliveryTarget(params.automationId, params.workspaceKey);
  if (!target) return false;
  await params.botsService.watchAutomationRun({
    target,
    ...(params.runId ? { runId: params.runId } : {}),
    taskId: params.taskId,
    workspacePath: params.workspacePath,
    ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
  });
  return true;
}
