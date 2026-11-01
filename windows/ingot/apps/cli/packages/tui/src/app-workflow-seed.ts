//
import React from "react";
import type { TuiCopy } from "@origin-ai/cf-i18n";
import type { WorkflowRunProgressEnvelope } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { Message } from "./app-model.js";
import type { TuiListWorkflowRuns, TuiReplayWorkflowRuns, TuiWorkflowRunSummary } from "./types.js";
import type { TuiWorkflowRunSeed } from "./app-workflow-mirror.js";

export function workflowRunSeedFromSummary(summary: TuiWorkflowRunSummary): TuiWorkflowRunSeed {
  return {
    runId: summary.runId,
    ...(summary.label === undefined ? {} : { label: summary.label }),
    ...(summary.updatedAt === undefined ? {} : { updatedAt: summary.updatedAt }),
  };
}

export function workflowInterruptedNoticeText(seed: TuiWorkflowRunSeed, copy: TuiCopy): string {
  return copy.transcript.workflow.interruptedNotice({
    label: seed.label ?? seed.runId,
    runId: seed.runId,
  });
}

export function appendWorkflowInterruptedNotices(
  messages: Message[],
  seeds: readonly TuiWorkflowRunSeed[],
  copy: TuiCopy,
): Message[] {
  if (seeds.length === 0) return messages;
  return [
    ...messages,
    ...seeds.map((seed) => ({
      content: workflowInterruptedNoticeText(seed, copy),
      role: "system" as const,
    })),
  ];
}

export function interruptedWorkflowNotices(
  summaries: readonly TuiWorkflowRunSummary[],
): readonly TuiWorkflowRunSeed[] {
  return summaries.filter((summary) => summary.resumable === true).map(workflowRunSeedFromSummary);
}

export function useWorkflowRunSeeding(input: {
  copy: TuiCopy;
  listWorkflowRuns?: TuiListWorkflowRuns;
  replayWorkflowRuns?: TuiReplayWorkflowRuns;
  
  knownRunIds: () => ReadonlySet<string>;
  replay: (envelopes: readonly WorkflowRunProgressEnvelope[]) => void;
  seed: (seeds: readonly TuiWorkflowRunSeed[]) => void;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
}): void {
  const latest = React.useRef(input);
  latest.current = input;
  const { listWorkflowRuns, replayWorkflowRuns } = input;

  React.useEffect(() => {
    if (!listWorkflowRuns && !replayWorkflowRuns) return;
    let cancelled = false;
    void (async () => {
      if (replayWorkflowRuns) {
        try {
          const envelopes = await replayWorkflowRuns({
            excludeRunIds: latest.current.knownRunIds(),
          });
          if (cancelled) return;
          if (envelopes.length > 0) latest.current.replay(envelopes);
        } catch {
        }
      }
      if (!listWorkflowRuns) return;
      let summaries: readonly TuiWorkflowRunSummary[];
      try {
        summaries = await listWorkflowRuns();
      } catch {
        return;
      }
      if (cancelled || summaries.length === 0) return;
      latest.current.seed(summaries.map(workflowRunSeedFromSummary));
      const resumable = interruptedWorkflowNotices(summaries);
      if (resumable.length === 0) return;
      latest.current.setMessages((current) =>
        appendWorkflowInterruptedNotices(current, resumable, latest.current.copy),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [listWorkflowRuns, replayWorkflowRuns]);
}
