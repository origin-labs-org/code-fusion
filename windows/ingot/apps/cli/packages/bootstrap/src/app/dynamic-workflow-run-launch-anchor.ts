// ============================================================
// ============================================================
//

import type { TraceContext } from "@origin-ai/cf-contracts";
import type { JournalStorePort, RunEvent } from "@origin-ai/cf-dynamic-workflow";
import { uuidv7 } from "@origin-ai/cf-shared";
import {
  parseWorkflowSubagentPermissionMode,
  type WorkflowSubagentPermissionMode,
} from "./workflow-actor-permission.js";

export interface RunLaunchAnchor {
  
  inputId: string;
}

export interface RunLaunch extends RunLaunchAnchor {
  phaseNames?: string[];
  subagentModel?: string;
  
  modelBindings?: Record<string, string>;
  
  scriptPath?: string;
  
  subagentPermissionMode?: WorkflowSubagentPermissionMode;
  
  phaseAlongside?: number[][];
}

function firstRunLaunched(
  journal: JournalStorePort,
  runId: string,
): Extract<RunEvent, { type: "run-launched" }> | undefined {
  const [stored] = journal.listEvents(runId, {
    types: ["run-launched"],
    reportItems: { limit: 0 },
    limit: 1,
  });
  return stored?.event.type === "run-launched" ? stored.event : undefined;
}

export function readRunLaunchAnchor(
  journal: JournalStorePort,
  runId: string,
): RunLaunchAnchor | undefined {
  const launched = firstRunLaunched(journal, runId);
  return launched === undefined ? undefined : { inputId: launched.inputId };
}

export function readRunSubagentModel(journal: JournalStorePort, runId: string): string | undefined {
  return firstRunLaunched(journal, runId)?.subagentModel;
}

export function readRunModelBindings(
  journal: JournalStorePort,
  runId: string,
): Record<string, string> | undefined {
  return firstRunLaunched(journal, runId)?.modelBindings;
}

export function readRunSubagentPermissionMode(
  journal: JournalStorePort,
  runId: string,
): WorkflowSubagentPermissionMode | undefined {
  const launched = firstRunLaunched(journal, runId);
  return launched === undefined
    ? undefined
    : parseWorkflowSubagentPermissionMode(launched.subagentPermissionMode);
}

export function readRunScriptPath(journal: JournalStorePort, runId: string): string | undefined {
  let minted: string | undefined;
  for (const { event } of journal.listEvents(runId, {
    types: ["hole-filled"],
    reportItems: { limit: 0 },
  })) {
    if (event.type === "hole-filled" && event.scriptPath !== undefined) minted = event.scriptPath;
  }
  return minted ?? firstRunLaunched(journal, runId)?.scriptPath;
}

export function resolveLaunchAnchor(input: {
  requested?: string;
  trace: TraceContext;
  resolveLaunchInputId?: (trace: TraceContext) => string | undefined;
  predecessor?: RunLaunchAnchor;
  mint?: () => string;
}): RunLaunchAnchor {
  if (input.predecessor !== undefined) return input.predecessor;
  const inputId =
    input.requested ?? input.resolveLaunchInputId?.(input.trace) ?? (input.mint ?? uuidv7)();
  return { inputId };
}
