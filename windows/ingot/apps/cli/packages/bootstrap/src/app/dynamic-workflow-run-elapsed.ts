// ============================================================
// ============================================================
//
//

import type { JournalStorePort } from "@origin-ai/cf-dynamic-workflow";
import { supportsRunLifeSpans } from "./dynamic-workflow-run-journal.js";

const LINEAGE_HOP_LIMIT = 64;

export function runLineageActiveMs(journal: JournalStorePort, runId: string): number | undefined {
  if (!supportsRunLifeSpans(journal)) return undefined;
  let total = 0;
  let sawLife = false;
  let cursor: string | undefined = runId;
  const visited = new Set<string>();
  for (let hop = 0; cursor !== undefined && hop < LINEAGE_HOP_LIMIT; hop += 1) {
    if (visited.has(cursor)) break;
    visited.add(cursor);
    for (const life of journal.listRunLifeSpans(cursor)) {
      sawLife = true;
      total += Math.max(0, life.lastActivityAt - life.startedAt);
    }
    cursor = journal.getRun(cursor)?.resumedFrom;
  }
  return sawLife ? total : undefined;
}
