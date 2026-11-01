// ============================================================
// ============================================================
// docs/dynamic-workflow/transcript-and-notifications.md「Reminding an idle main agent」。
//
//
//

import type { DynamicWorkflowRunHole, DynamicWorkflowRunPendingQuestion } from "@origin-ai/cf-contracts";

const MINUTE_MS = 60_000;

export const WORKFLOW_BLOCKED_REMINDER_DELAYS_MS: readonly [number, number] = [
  15 * MINUTE_MS,
  30 * MINUTE_MS,
];

export interface WorkflowOpenDecisions {
  questions: readonly DynamicWorkflowRunPendingQuestion[];
  holes: readonly DynamicWorkflowRunHole[];
  
  draftPath?: string;
}

export interface WorkflowBlockedReminder {
  runId: string;
  open: WorkflowOpenDecisions;
  ordinal: number;
  total: number;
  now: number;
}

export interface WorkflowBlockedReminderHost {
  
  liveRunIds(): readonly string[];
  
  isIdle(): boolean;
  
  readOpen(runId: string): Promise<WorkflowOpenDecisions | undefined>;
  
  remind(reminder: WorkflowBlockedReminder): void;
  
  onReadError?(runId: string, error: unknown): void;
  now?(): number;
  
  setTimer?(callback: () => void, delayMs: number): () => void;
}

function defaultSetTimer(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs);
  timer.unref?.();
  return () => clearTimeout(timer);
}

export class WorkflowBlockedReminderClock {
  
  private readonly sent = new Map<string, number>();
  
  private idleSince: number | undefined;
  private cancelTimer: (() => void) | undefined;
  
  private epoch = 0;
  private stopped = false;

  constructor(
    private readonly host: WorkflowBlockedReminderHost,
    private readonly delays: readonly number[] = WORKFLOW_BLOCKED_REMINDER_DELAYS_MS,
  ) {}

  
  sessionBusy(): void {
    this.idleSince = undefined;
    this.disarm();
  }

  
  sessionIdle(): void {
    if (this.stopped || this.idleSince !== undefined) return;
    this.idleSince = this.now();
    this.arm(0);
  }

  
  userSpoke(): void {
    this.sent.clear();
  }

  
  openSetChanged(runId: string): void {
    this.sent.delete(runId);
    if (this.stopped || this.idleSince === undefined) return;
    this.idleSince = this.now();
    this.arm(0);
  }

  
  stop(): void {
    this.stopped = true;
    this.idleSince = undefined;
    this.disarm();
  }

  private now(): number {
    return this.host.now?.() ?? Date.now();
  }

  private disarm(): void {
    this.epoch += 1;
    this.cancelTimer?.();
    this.cancelTimer = undefined;
  }

  
  private delayFor(runId: string): number | undefined {
    return this.delays[this.sent.get(runId) ?? 0];
  }

  
  private liveRuns(): readonly string[] {
    const live = this.host.liveRunIds();
    if (this.sent.size > 0) {
      const alive = new Set(live);
      for (const runId of [...this.sent.keys()]) {
        if (!alive.has(runId)) this.sent.delete(runId);
      }
    }
    return live;
  }

  
  private arm(reached: number): void {
    this.disarm();
    if (this.idleSince === undefined) return;
    let next: number | undefined;
    for (const runId of this.liveRuns()) {
      const delay = this.delayFor(runId);
      if (delay === undefined || delay <= reached) continue;
      if (next === undefined || delay < next) next = delay;
    }
    if (next === undefined) return;
    const epoch = this.epoch;
    const target = next;
    const wait = Math.max(0, this.idleSince + target - this.now());
    const setTimer = this.host.setTimer ?? defaultSetTimer;
    this.cancelTimer = setTimer(() => {
      void this.expire(epoch, target);
    }, wait);
  }

  
  private async expire(epoch: number, reached: number): Promise<void> {
    if (epoch !== this.epoch || this.stopped) return;
    this.cancelTimer = undefined;
    if (!this.host.isIdle()) return;

    const due: { runId: string; open: WorkflowOpenDecisions }[] = [];
    for (const runId of this.liveRuns()) {
      const delay = this.delayFor(runId);
      if (delay === undefined || delay > reached) continue;
      try {
        const open = await this.host.readOpen(runId);
        if (open !== undefined && open.questions.length + open.holes.length > 0) {
          due.push({ runId, open });
        }
      } catch (error) {
        this.host.onReadError?.(runId, error);
      }
    }
    if (epoch !== this.epoch) return;

    const now = this.now();
    for (const { runId, open } of due) {
      const ordinal = (this.sent.get(runId) ?? 0) + 1;
      this.sent.set(runId, ordinal);
      this.host.remind({ runId, open, ordinal, total: this.delays.length, now });
    }
    if (epoch === this.epoch) this.arm(reached);
  }
}
