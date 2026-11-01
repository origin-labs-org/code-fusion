// ============================================================
// ============================================================
//
//
//
//
//        │
//

import type {
  DynamicWorkflowRunArtifactBytes,
  ToolArtifactStorePort,
} from "@origin-ai/cf-contracts";
import type { JournalStorePort } from "@origin-ai/cf-dynamic-workflow";

import {
  artifactRowId,
  supportsArtifactReads,
} from "./dynamic-workflow-run-artifact-queries.js";

interface WorkflowArtifactReadDeps {
  journal: JournalStorePort;
  
  parentSessionId: string;
  
  artifactStore?: ToolArtifactStorePort;
}

export async function readWorkflowArtifactBytes(
  deps: WorkflowArtifactReadDeps,
  runId: string,
  artifactId: string,
  version: number,
): Promise<DynamicWorkflowRunArtifactBytes | undefined> {
  const store = deps.artifactStore;
  if (store?.readToolResultBinaryArtifact === undefined) return undefined;

  const run = deps.journal.getRun(runId);
  if (run === undefined) return undefined;
  if (run.parentSessionId === undefined || run.parentSessionId !== deps.parentSessionId) {
    return undefined;
  }

  const located = locateArtifactVersion(deps.journal, runId, artifactId, version);
  if (located === undefined) return undefined;

  const result = await store.readToolResultBinaryArtifact({ uri: located.uri });
  return {
    bytes: result.bytes,
    contentType: located.contentType ?? result.contentType,
  };
}

function locateArtifactVersion(
  journal: JournalStorePort,
  runId: string,
  artifactId: string,
  version: number,
): { uri: string; contentType?: string } | undefined {
  if (!supportsArtifactReads(journal)) return undefined;
  for (const row of journal.listArtifactRows(runId)) {
    if (row.status !== "completed") continue;
    if (artifactRowId(row) !== artifactId) continue;
    const record = row.result;
    if (record === null || typeof record !== "object" || Array.isArray(record)) continue;
    const fields = record as Record<string, unknown>;
    if (fields.version !== version) continue;
    const uri = typeof fields.uri === "string" && fields.uri.length > 0 ? fields.uri : undefined;
    if (uri === undefined) return undefined;
    const contentType =
      typeof fields.contentType === "string" && fields.contentType.length > 0
        ? fields.contentType
        : undefined;
    return { uri, ...(contentType === undefined ? {} : { contentType }) };
  }
  return undefined;
}
