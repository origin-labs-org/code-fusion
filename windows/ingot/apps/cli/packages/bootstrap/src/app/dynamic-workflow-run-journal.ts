// ============================================================
// ============================================================
//

import type { DwfRunIntrospectionQueries, DwfRunSessionListItem } from "@origin-ai/cf-adapters/storage";
import type { CreateSessionTaskLinkInput, Logger, SessionStorePort } from "@origin-ai/cf-contracts";
import type { JournalStorePort, RunRecord, StoredEvent } from "@origin-ai/cf-dynamic-workflow";

export interface DynamicWorkflowTaskLinkStore {
  createSessionTaskLink(input: CreateSessionTaskLinkInput): Promise<unknown>;
}

export function isDynamicWorkflowTaskLinkStore(
  store: SessionStorePort | undefined,
): store is SessionStorePort & DynamicWorkflowTaskLinkStore {
  return (
    typeof (store as { createSessionTaskLink?: unknown } | undefined)?.createSessionTaskLink ===
    "function"
  );
}

export function resolveDynamicWorkflowJournalStore(
  sessionStore: SessionStorePort | undefined,
  logger?: Logger,
): JournalStorePort | undefined {
  const candidate = sessionStore as
    | (SessionStorePort & { workflowJournalStore?: () => JournalStorePort })
    | undefined;
  if (typeof candidate?.workflowJournalStore !== "function") {
    logger?.info?.("Dynamic workflow run service disabled: session store has no dwf journal", {
      event: "dynamic_workflow.run_service.unavailable",
      module: "bootstrap.app",
      reason: "session_store_missing_workflow_journal_store",
    });
    return undefined;
  }
  return candidate.workflowJournalStore();
}

interface DynamicWorkflowJournalStore extends JournalStorePort {
  listNonTerminalRuns(parentSessionId: string): RunRecord[];
  
  listRunsByParentSession(parentSessionId: string, limit: number): DwfRunSessionListItem[];
}

export function supportsNonTerminalRunQuery(
  journal: JournalStorePort,
): journal is JournalStorePort & Pick<DynamicWorkflowJournalStore, "listNonTerminalRuns"> {
  return (
    typeof (journal as Partial<DynamicWorkflowJournalStore>).listNonTerminalRuns === "function"
  );
}

export function supportsRunEnumeration(
  journal: JournalStorePort,
): journal is JournalStorePort & Pick<DynamicWorkflowJournalStore, "listRunsByParentSession"> {
  return (
    typeof (journal as Partial<DynamicWorkflowJournalStore>).listRunsByParentSession === "function"
  );
}

export interface DynamicWorkflowIntrospectableJournal
  extends JournalStorePort, DwfRunIntrospectionQueries {}

export function supportsRunLifeSpans(
  journal: JournalStorePort,
): journal is JournalStorePort & Pick<DwfRunIntrospectionQueries, "listRunLifeSpans"> {
  return typeof (journal as Partial<DwfRunIntrospectionQueries>).listRunLifeSpans === "function";
}

export function supportsEventPages(
  journal: JournalStorePort,
): journal is JournalStorePort & Pick<DwfRunIntrospectionQueries, "listEventPage"> {
  return typeof (journal as Partial<DwfRunIntrospectionQueries>).listEventPage === "function";
}

export function pageByCountOnly(
  journal: JournalStorePort,
  runId: string,
  page: { afterSequence?: number; limit: number },
): { events: StoredEvent[]; hasMore: boolean } {
  const read = journal.listEvents(runId, {
    types: "all",
    reportItems: "all",
    ...(page.afterSequence === undefined ? {} : { afterSequence: page.afterSequence }),
    limit: page.limit + 1,
  });
  const hasMore = read.length > page.limit;
  return { events: hasMore ? read.slice(0, page.limit) : read, hasMore };
}

export function supportsRunIntrospection(
  journal: JournalStorePort,
): journal is DynamicWorkflowIntrospectableJournal {
  const candidate = journal as Partial<DwfRunIntrospectionQueries>;
  return (
    typeof candidate.countNodesByStatus === "function" &&
    typeof candidate.getRunRow === "function" &&
    typeof candidate.listRecentLogEvents === "function" &&
    typeof candidate.listRuns === "function"
  );
}
