

import { isArtifactPresetOp } from "../facade/registry.js";
import { NODE_KINDS, type RunEventType } from "./journal-read-types.js";
import type { InstanceRef, JournalStorePort, NodeKind, NodeRecord, RunEvent } from "./types.js";
import { refToString } from "./types.js";

export const REPLAY_WORK_KINDS: readonly NodeKind[] = NODE_KINDS.filter(
  (kind) => kind !== "report" && kind !== "artifact",
);

const SETTLE_EVENT_TYPES: readonly RunEventType[] = [
  "node-settled",
  "artifact-published",
  "artifact-failed",
];

export function readReplayRows(
  journal: JournalStorePort,
  runId: string,
): { workRows: NodeRecord[]; artifactRows: NodeRecord[] } {
  return {
    workRows: journal.listNodes(runId, { kinds: REPLAY_WORK_KINDS, withResult: false }),
    artifactRows: journal.listNodes(runId, { kinds: ["artifact"], withResult: true }),
  };
}

export class ReplaySettleOrder {
  
  private readonly position: ReadonlyMap<string, number>;
  
  private cursor = 0;
  
  private readonly parked = new Map<string, () => void>();
  
  private queue: Array<() => void> = [];
  private flushing = false;
  
  private opened = false;

  constructor(private readonly order: readonly string[] = []) {
    const position = new Map<string, number>();
    order.forEach((key, index) => position.set(key, index));
    this.position = position;
  }

  static empty(): ReplaySettleOrder {
    return new ReplaySettleOrder([]);
  }

  
  recorded(): readonly string[] {
    return this.order;
  }

  
  hold(instance: InstanceRef, release: () => void): void {
    const key = refToString(instance);
    const at = this.position.get(key);
    if (this.opened || at === undefined || at < this.cursor) {
      release();
      return;
    }
    this.parked.set(key, release);
    this.pump();
  }

  
  private enqueue(release: () => void): void {
    this.queue.push(release);
    if (this.flushing) return;
    this.flushing = true;
    queueMicrotask(() => this.flush());
  }

  
  private flush(): void {
    this.flushing = false;
    const batch = this.queue;
    this.queue = [];
    for (const release of batch) release();
  }

  
  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.flush();
    for (let i = this.cursor; i < this.order.length; i++) {
      const key = this.order[i];
      if (key === undefined) continue;
      const release = this.parked.get(key);
      if (release === undefined) continue;
      this.parked.delete(key);
      release();
    }
    this.cursor = this.order.length;
    const leftovers = [...this.parked.values()];
    this.parked.clear();
    for (const release of leftovers) release();
  }

  
  private pump(): void {
    while (this.cursor < this.order.length) {
      const key = this.order[this.cursor];
      if (key === undefined) break;
      const release = this.parked.get(key);
      if (release === undefined) break;
      this.parked.delete(key);
      this.cursor++;
      this.enqueue(release);
    }
  }
}

export function recoverSettleOrder(
  journal: JournalStorePort,
  runId: string,
  
  nodes: readonly NodeRecord[] = Object.values(readReplayRows(journal, runId)).flat(),
): ReplaySettleOrder {
  const claimable = new Set<string>();
  for (const node of nodes) {
    if (node.status !== "completed" && node.status !== "failed") continue;
    if (!claimsOnReplay(node)) continue;
    claimable.add(refToString(node));
  }
  if (claimable.size === 0) return ReplaySettleOrder.empty();

  const order: string[] = [];
  const seen = new Set<string>();
  for (const { event } of journal.listEvents(runId, {
    types: SETTLE_EVENT_TYPES,
    reportItems: { limit: 0 },
  })) {
    const key = settledInstanceKey(event);
    if (key === undefined || seen.has(key) || !claimable.has(key)) continue;
    seen.add(key);
    order.push(key);
  }
  return new ReplaySettleOrder(order);
}

function settledInstanceKey(event: RunEvent): string | undefined {
  if (
    event.type === "node-settled" ||
    event.type === "artifact-published" ||
    event.type === "artifact-failed"
  ) {
    return refToString(event.instance);
  }
  return undefined;
}

function claimsOnReplay(node: NodeRecord): boolean {
  if (node.kind === "report") return false;
  if (node.kind !== "artifact") return true;
  if (node.status === "failed") return true;
  const kind = (node.result as { kind?: unknown } | undefined)?.kind;
  return typeof kind === "string" && !isArtifactPresetOp(kind);
}

export function heldResolution<T>(
  hold: (instance: InstanceRef, release: () => void) => void,
  instance: InstanceRef,
  settle: () => T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    hold(instance, () => {
      try {
        resolve(settle());
      } catch (cause) {
        reject(cause);
      }
    });
  });
}
