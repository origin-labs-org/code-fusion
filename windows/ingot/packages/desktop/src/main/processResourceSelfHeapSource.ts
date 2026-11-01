

import { nodeSelfResourceSampleSchema, type ProcessResourceRole } from "@origin-ai/cf-shared";
import type { ProcessResourceSampleSource } from "./processResourceSampleSources.js";

const pendingHeapUsedKb = new Map<ProcessResourceRole, number>();

function ingest(role: ProcessResourceRole, raw: unknown): void {
  const parsed = nodeSelfResourceSampleSchema.safeParse(raw);
  if (!parsed.success) {
    return;
  }
  pendingHeapUsedKb.set(role, Math.max(pendingHeapUsedKb.get(role) ?? 0, parsed.data.heapUsedKb));
}

export function ingestHostSelfResourceSample(raw: unknown): void {
  ingest("host", raw);
}

export function ingestSchedulerSelfResourceSample(raw: unknown): void {
  ingest("scheduler", raw);
}

export const selfHeapProcessResourceSampleSource: ProcessResourceSampleSource = {
  id: "self_heap",
  sample(context) {
    const delivering = [...pendingHeapUsedKb];
    pendingHeapUsedKb.clear();
    for (const [role, heapUsedKb] of delivering) {
      context.addRoleHeapSample(role, heapUsedKb);
    }
  },
  reset() {
    pendingHeapUsedKb.clear();
  },
};
