

import type { RunRecord, StoredEvent } from "../engine/index.js";

const CAPS = { maxConcurrency: 4 };

export function baseRun(runId: string): RunRecord {
  return { runId, caps: CAPS, spentTokens: 0, status: "running" };
}

export function logs(events: StoredEvent[]): string[] {
  return events.map((e) => (e.event.type === "log" ? e.event.message : `<${e.event.type}>`));
}
