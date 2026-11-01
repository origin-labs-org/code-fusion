import type { CfTaskMeta } from "@origin-ai/cf-shared";
import type { TaskIndexRepo } from "#src/session/taskIndexRepo.js";

export async function seedTaskIndex(
  repo: TaskIndexRepo,
  input: {
    meta: CfTaskMeta;
    pinned?: boolean;
    archived?: boolean;
    deleted?: boolean;
    titleOverridden?: boolean;
    searchableText?: string;
  },
): Promise<CfTaskMeta> {
  const { meta } = input;
  await repo.applyCliFacts({
    meta,
    titleSource: (input.titleOverridden ?? meta.titleOverridden) ? "custom" : "generated",
    lastOutcome: meta.status === "completed" || meta.status === "error" ? meta.status : undefined,
  });
  const {
    mode,
    model,
    thoughtLevel,
    lastError,
    target,
    migrationSource,
    cronAutomationId,
    offPeakTaskId,
  } = meta;
  await repo.updateTaskPresentation({
    ...meta,
    presentation: Object.fromEntries(
      Object.entries({
        mode,
        model,
        thoughtLevel,
        lastError,
        target,
        migrationSource,
        cronAutomationId,
        offPeakTaskId,
      }).filter(([, value]) => value !== undefined),
    ),
    searchableText: input.searchableText,
  });
  if (input.pinned !== undefined || input.archived !== undefined)
    await repo.updateTaskState({
      ...meta,
      patch: {
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
        ...(input.archived !== undefined ? { archived: input.archived } : {}),
      },
    });
  if (input.deleted) await repo.applyCliDeletion(meta);
  return (await repo.getTaskMeta(meta))!;
}
