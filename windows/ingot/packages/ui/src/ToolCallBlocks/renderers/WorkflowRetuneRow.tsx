// ============================================================
// ============================================================
//

import type { WorkflowSettingsAmendMeta } from "@origin-ai/cf-shared/cf-protocol-v4";
import { WorkflowSettingsChangeRow } from "@/components/workflow-timeline/WorkflowSettingsChangeRow.js";

function retuneAsAmendMeta(
  requested: number | null,
  defaultConcurrency: number | undefined,
): WorkflowSettingsAmendMeta {
  return {
    maxConcurrency: requested === null ? {} : { to: requested },
    ...(defaultConcurrency === undefined ? {} : { ceiling: defaultConcurrency }),
  };
}

export function WorkflowRetuneRow({
  defaultConcurrency,
  onOpen,
  requested,
  runId,
}: {
  
  defaultConcurrency?: number;
  
  onOpen?: () => void;
  requested: number | null;
  runId: string;
}) {
  const row = (
    <WorkflowSettingsChangeRow amend={retuneAsAmendMeta(requested, defaultConcurrency)} />
  );
  if (onOpen === undefined) {
    return (
      <div data-testid="workflow-retune-row" data-workflow-retune-run-id={runId}>
        {row}
      </div>
    );
  }
  return (
    <button
      className="flex w-full min-w-0 cursor-pointer rounded-md px-1 text-left transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring/40"
      data-testid="workflow-retune-row"
      data-workflow-retune-run-id={runId}
      onClick={onOpen}
      type="button"
    >
      {row}
    </button>
  );
}
