// ============================================================
// 「An inline draft counts as written by the model」）
// ============================================================
//
//

import { createReadFileStateMetadataFromEntry } from "../read-file-state-metadata.js";
import { createReadFileStateKey, normalizeReadFileStateMtimeMs } from "../read-file-state.js";
import type { ReadFileStateEntry, ToolExecutionContext } from "../types.js";

export type WorkflowDraftAuthoringTool = "CreateWorkflow" | "AmendWorkflow" | "FillWorkflowHole";

const CRLF_PATTERN = /\r\n/gu;
const LF = "\n";

export async function recordAuthoredWorkflowDraft(
  context: ToolExecutionContext,
  draft: { path: string; source: string; toolName: WorkflowDraftAuthoringTool },
): Promise<void> {
  const { fileSystemPort, readFileState } = context;
  if (readFileState === undefined || fileSystemPort === undefined) return;

  let revision: { id: string; mtimeMs?: number; sizeBytes?: number } | undefined;
  try {
    const info = await fileSystemPort.stat(
      { path: draft.path, trace: context.traceContext },
      { signal: context.abortSignal },
    );
    revision = info.revision;
  } catch {
    return;
  }
  if (revision === undefined) return;

  const entry: ReadFileStateEntry = {
    path: draft.path,
    content: draft.source.replace(CRLF_PATTERN, LF),
    offset: undefined,
    limit: undefined,
    isPartialView: false,
    readAt: new Date(),
    sourceTool: draft.toolName,
    revisionId: revision.id,
    mtimeMs: normalizeReadFileStateMtimeMs(revision.mtimeMs),
    sizeBytes: revision.sizeBytes ?? Buffer.byteLength(draft.source, "utf8"),
  };
  readFileState.set(createReadFileStateKey(draft.path, 1, undefined), entry);

  const metadata = createReadFileStateMetadataFromEntry({
    completedAt: entry.readAt,
    entry,
    toolName: draft.toolName,
  });
  if (metadata !== undefined) context.recordReadFileStateMetadata?.(metadata);
}
