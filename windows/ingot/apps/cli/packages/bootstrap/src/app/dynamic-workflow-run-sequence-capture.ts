import type { JournalStorePort, RunEvent, StoredEvent } from "@origin-ai/cf-dynamic-workflow";

export function createJournalSequenceCapture(journal: JournalStorePort): {
  journal: JournalStorePort;
  sequenceOf: (event: RunEvent) => number;
  
  timeCreatedOf: (event: RunEvent) => number | undefined;
} {
  let lastStored: StoredEvent | undefined;
  const wrapped: JournalStorePort = {
    createRun: (record) => journal.createRun(record),
    getRun: (runId) => journal.getRun(runId),
    updateRunStatus: (runId, status, settlement) =>
      journal.updateRunStatus(runId, status, settlement),
    updateRunUsage: (runId, spentTokens) => journal.updateRunUsage(runId, spentTokens),
    updateRunCaps: (runId, caps) => journal.updateRunCaps(runId, caps),
    updateRunScript: (runId, scriptText, scriptHash) =>
      journal.updateRunScript(runId, scriptText, scriptHash),
    putActor: (record) => journal.putActor(record),
    getActor: (runId, siteId, ordinal) => journal.getActor(runId, siteId, ordinal),
    listActors: (runId, opts) => journal.listActors(runId, opts),
    putNode: (record) => journal.putNode(record),
    getNode: (runId, siteId, ordinal, opts) => journal.getNode(runId, siteId, ordinal, opts),
    listNodes: (runId, opts) => journal.listNodes(runId, opts),
    countNodes: (runId, kind) => journal.countNodes(runId, kind),
    sumResultBytes: (runId, kind) => journal.sumResultBytes(runId, kind),
    appendEvent: (runId, event) => {
      const stored = journal.appendEvent(runId, event);
      lastStored = stored;
      return stored;
    },
    listEvents: (runId, opts) => journal.listEvents(runId, opts),
  };
  return {
    journal: wrapped,
    sequenceOf: (event) =>
      lastStored?.event === event ? lastStored.sequence : (lastStored?.sequence ?? 0),
    timeCreatedOf: () => lastStored?.timeCreated,
  };
}
