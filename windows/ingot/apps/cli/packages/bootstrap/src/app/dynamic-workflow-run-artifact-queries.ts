// ============================================================
// ============================================================
//

import type { DwfArtifactItem, DwfRunIntrospectionQueries } from "@origin-ai/cf-adapters/storage";
import type { DynamicWorkflowRunArtifactItem } from "@origin-ai/cf-contracts";
import type { JournalStorePort, NodeRecord } from "@origin-ai/cf-dynamic-workflow";
import { WORKFLOW_ARTIFACT_LIMITS } from "@origin-ai/cf-shared/cf-protocol-v4";

interface ArtifactReadableJournal
  extends JournalStorePort, Pick<DwfRunIntrospectionQueries, "listArtifactItems" | "listArtifactRows"> {}

export function supportsArtifactReads(journal: JournalStorePort): journal is ArtifactReadableJournal {
  const candidate = journal as Partial<DwfRunIntrospectionQueries>;
  return (
    typeof candidate.listArtifactItems === "function" &&
    typeof candidate.listArtifactRows === "function"
  );
}

export function listArtifactItemsFrom(
  journal: JournalStorePort,
  runId: string,
  artifactId: string,
  page: { afterSequence?: number; limit: number; maxBytes: number; fields?: readonly string[] },
): { items: DynamicWorkflowRunArtifactItem[]; hasMore: boolean } {
  if (!supportsArtifactReads(journal)) return { items: [], hasMore: false };
  const { items, hasMore } = journal.listArtifactItems(runId, artifactId, {
    ...(page.afterSequence === undefined ? {} : { afterSequence: page.afterSequence }),
    limit: page.limit,
    maxBytes: page.maxBytes,
    ...(page.fields === undefined
      ? {}
      : {
          fields: {
            paths: page.fields,
            maxValueBytes: WORKFLOW_ARTIFACT_LIMITS.maxFieldValueBytes,
          },
        }),
  });
  return { items: items.map(toArtifactItem), hasMore };
}

function toArtifactItem(row: DwfArtifactItem): DynamicWorkflowRunArtifactItem {
  return {
    sequence: row.sequence,
    siteId: row.siteId,
    ordinal: row.ordinal,
    ...(row.fields === undefined ? { item: row.item } : { fields: row.fields }),
  };
}

export function artifactRowId(row: NodeRecord): string | undefined {
  if (typeof row.artifactId === "string" && row.artifactId.length > 0) return row.artifactId;
  const record = row.result;
  if (record === null || typeof record !== "object" || Array.isArray(record)) return undefined;
  const id = (record as Record<string, unknown>).id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}
