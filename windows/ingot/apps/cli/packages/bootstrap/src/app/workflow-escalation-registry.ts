// ============================================================
// ============================================================
//
//
//

import type {
  DynamicWorkflowResolveQuestionResult,
  DynamicWorkflowRunPendingQuestion,
} from "@origin-ai/cf-contracts";

const RETIRED_HISTORY_LIMIT = 256;

export interface ParkedQuestionInput {
  qid: string;
  runId: string;
  
  actor: string;
  
  actorName?: string;
  question: string;
  context?: string;
  askedAt: number;
}

type RetiredReason = "resolved" | "withdrawn";

export interface WorkflowEscalationRegistry {
  
  park(entry: ParkedQuestionInput, settle: (answer: string) => void): void;
  
  isTaken(qid: string): boolean;
  
  withdraw(qid: string): void;
  
  resolve(qid: string, answer: string): DynamicWorkflowResolveQuestionResult;
  
  pendingFor(runId: string): DynamicWorkflowRunPendingQuestion[];
}

interface ParkedQuestion extends ParkedQuestionInput {
  settle: (answer: string) => void;
}

export function createWorkflowEscalationRegistry(): WorkflowEscalationRegistry {
  const parked = new Map<string, ParkedQuestion>();
  const retired = new Map<string, RetiredReason>();

  const retire = (qid: string, reason: RetiredReason): void => {
    parked.delete(qid);
    retired.set(qid, reason);
    while (retired.size > RETIRED_HISTORY_LIMIT) {
      const oldest = retired.keys().next();
      if (oldest.done === true) break;
      retired.delete(oldest.value);
    }
  };

  return {
    park(entry, settle) {
      parked.set(entry.qid, { ...entry, settle });
    },

    isTaken(qid) {
      return parked.has(qid) || retired.has(qid);
    },

    withdraw(qid) {
      if (!parked.has(qid)) return;
      retire(qid, "withdrawn");
    },

    resolve(qid, answer) {
      const entry = parked.get(qid);
      if (entry === undefined) {
        const reason = retired.get(qid);
        if (reason === "resolved") {
          return {
            ok: false,
            reason: "already_resolved",
            message:
              `Question ${qid} was already answered and the subagent has moved on with that ` +
              `answer. No need to answer again; if you have more to add, wait for its next ` +
              `escalation.`,
          };
        }
        if (reason === "withdrawn") {
          return {
            ok: false,
            reason: "run_not_in_flight",
            message:
              `The ask that raised question ${qid} is no longer in flight (the run was ` +
              `cancelled, or that ask already failed), so nobody is waiting for this answer. ` +
              `Use GetWorkflowRun to see the run's current state before deciding what to do next.`,
          };
        }
        return {
          ok: false,
          reason: "unknown_question",
          message:
            `Unknown question id ${qid}. It may be misspelled, or it may come from a process ` +
            `that is gone: parked questions are not persisted, so they vanish on restart (a ` +
            `resume makes the subagent ask again under a new id). Use GetWorkflowRun to read ` +
            `the run's pendingQuestions for the ids that are actually awaiting an answer.`,
        };
      }
      retire(qid, "resolved");
      entry.settle(answer);
      return { ok: true, qid };
    },

    pendingFor(runId) {
      const out: DynamicWorkflowRunPendingQuestion[] = [];
      for (const entry of parked.values()) {
        if (entry.runId !== runId) continue;
        out.push({
          qid: entry.qid,
          actor: entry.actor,
          ...(entry.actorName === undefined ? {} : { actorName: entry.actorName }),
          question: entry.question,
          ...(entry.context === undefined ? {} : { context: entry.context }),
          askedAt: entry.askedAt,
        });
      }
      return out;
    },
  };
}
