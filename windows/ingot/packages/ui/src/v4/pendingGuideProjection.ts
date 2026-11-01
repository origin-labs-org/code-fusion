import type { QueueItem, QueueState } from "@origin-ai/cf-shared/cf-protocol-v4";

export interface PendingGuideQueueProjection {
  pendingGuides: readonly QueueItem[];
  visibleQueue: QueueState;
}

export function projectPendingGuideQueue(
  queue: QueueState,
): PendingGuideQueueProjection {
  const pendingGuides: QueueItem[] = [];
  const visibleItems: QueueItem[] = [];
  for (const item of queue.items) {
    if (item.delivery.admitted === "guide") {
      pendingGuides.push(item);
    } else {
      visibleItems.push(item);
    }
  }
  return {
    pendingGuides,
    visibleQueue:
      visibleItems.length === queue.items.length
        ? queue
        : { ...queue, items: visibleItems },
  };
}
