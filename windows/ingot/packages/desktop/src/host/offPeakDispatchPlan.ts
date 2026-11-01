import { OffPeakPermanentDispatchError } from "@origin-ai/cf-services/node";

export type OffPeakDispatchKind = "resume" | "bound-first-run" | "init";

export function resolveOffPeakDispatchKind(request: {
  conversationId?: string;
  sessionId?: string;
}): OffPeakDispatchKind {
  if (request.conversationId?.trim()) return "resume";
  if (request.sessionId?.trim()) return "bound-first-run";
  return "init";
}

export class OffPeakBoundSessionDeletedError extends OffPeakPermanentDispatchError {
  constructor(readonly sessionId: string) {
    super(`off-peak bound session was deleted: ${sessionId}`);
    this.name = "OffPeakBoundSessionDeletedError";
  }
}

export class OffPeakBoundSessionBusyError extends Error {
  constructor(readonly sessionId: string) {
    super(`off-peak bound session is busy: ${sessionId}`);
    this.name = "OffPeakBoundSessionBusyError";
  }
}

export function assertBoundSessionDispatchable(params: {
  sessionId: string;
  deleted: boolean;
  running: boolean;
}): void {
  if (params.deleted) throw new OffPeakBoundSessionDeletedError(params.sessionId);
  if (params.running) throw new OffPeakBoundSessionBusyError(params.sessionId);
}
