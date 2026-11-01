import type { WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import { phaseNameMatches } from "@/components/workflow-graph/phase-name.js";
import type { StepRunStatus } from "@/components/workflow-graph/types.js";
import type { StreamSpec } from "./timeline-bands.js";

export function isCurrentPhase(
  run: WorkflowRunState | undefined,
  name: string | undefined,
): boolean {
  return phaseNameMatches(name, run?.currentPhase);
}

export function stationStatus(
  run: WorkflowRunState | undefined,
  nodeStatus: StepRunStatus | undefined,
  current: boolean,
  entered: boolean,
): StepRunStatus | undefined {
  if (run === undefined) return undefined;
  if (nodeStatus === "running" || nodeStatus === "failed") return nodeStatus;
  const live = run.status === "running" || run.status === "pending";
  if (current && live) return "running";
  if (current) return run.status === "completed" ? "done" : "failed";
  if (nodeStatus !== undefined) return nodeStatus;
  return entered ? "done" : "pending";
}

export function stageStatuses(input: {
  run: WorkflowRunState | undefined;
  
  nodeStatuses: readonly (StepRunStatus | undefined)[];
  entered: readonly boolean[];
  
  hasMembers: readonly boolean[];
  
  alongside: readonly (readonly number[])[];
  streams: readonly StreamSpec[];
  
  sequential: readonly (StepRunStatus | undefined)[];
}): (StepRunStatus | undefined)[] {
  const { alongside, entered, hasMembers, nodeStatuses, run, sequential, streams } = input;
  if (run === undefined) return [...sequential];
  const parallel = new Set([
    ...streams.flatMap((stream) => [stream.from, stream.to]),
    ...alongside.flatMap((near, i) => (near.length > 0 ? [i, ...near] : [])),
  ]);
  const stage = nodeStatuses.map((_, i) => hasMembers[i] === true && parallel.has(i));
  const live = run.status === "running" || run.status === "pending";
  const feeders = nodeStatuses.map(() => [] as number[]);
  for (const stream of streams) feeders[stream.to]?.push(stream.from);

  const own = (i: number): StepRunStatus | undefined =>
    stage[i] ? (nodeStatuses[i] ?? "pending") : sequential[i];
  const open = nodeStatuses.map((_, i) => live && (own(i) === "running" || own(i) === "pending"));
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < open.length; i += 1) {
      if (open[i] || !live || !feeders[i]!.some((f) => open[f])) continue;
      open[i] = true;
      changed = true;
    }
  }

  return nodeStatuses.map((status, i) => {
    if (!stage[i]) return sequential[i];
    if (status === undefined) {
      if (live) return "pending";
      return run.status === "completed" && entered[i] ? "done" : "pending";
    }
    if (status === "done" && live && feeders[i]!.some((f) => open[f])) return "running";
    return status;
  });
}

export function phaseStreamIndexes(
  streams: readonly { from: string; to: string }[] | undefined,
  index: ReadonlyMap<string, number>,
): StreamSpec[] {
  const out: StreamSpec[] = [];
  const seen = new Set<string>();
  for (const stream of streams ?? []) {
    const from = index.get(stream.from);
    const to = index.get(stream.to);
    if (from === undefined || to === undefined || from === to || seen.has(`${from}>${to}`))
      continue;
    seen.add(`${from}>${to}`);
    out.push({ from, to });
  }
  return out;
}

export function streamInk(
  from: { status: StepRunStatus | undefined },
  to: { status: StepRunStatus | undefined; fraction?: unknown },
): "faint" | "strong" | "march" {
  if (from.status === "running" && to.status === "running") return "march";
  return to.fraction === undefined ? "faint" : "strong";
}
