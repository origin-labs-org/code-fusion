//

import type { MessageWithParts } from "@origin-ai/cf-contracts";
import type { CfWorkspaceRef } from "@origin-ai/cf-shared";

export type ColdSessionResumeOutcome =
  | {
      status: "resumed";
      persistedMessages?: MessageWithParts[];
      disposeOnFailure?: () => Promise<void>;
    }
  | { status: "notFound" };

export interface ColdSessionResumeHost {
  resumePersistedSession?(
    sessionId: string,
    resumeThoughtLevel?: string,
    workspace?: CfWorkspaceRef,
    additionalDirectories?: string[],
    persistedMessages?: MessageWithParts[],
  ): Promise<ColdSessionResumeOutcome>;
  onDebug?(message: string): void;
  onError?(scope: string, error: unknown, context?: Record<string, unknown>): void;
}

export class V4SubscribeSessionUnavailableError extends Error {
  constructor(
    readonly sessionId: string,
    readonly reasonCode: "fault.subscribe.sessionNotFound" | "fault.subscribe.resumeFailed",
    detail: string,
    options?: ErrorOptions,
  ) {
    super(`${detail} (${reasonCode})`, options);
    this.name = "V4SubscribeSessionUnavailableError";
  }
}

export class ColdSessionResumeCoordinator {
  
  private readonly flights = new Map<string, Promise<MessageWithParts[] | undefined>>();

  constructor(private readonly host: ColdSessionResumeHost) {}

  ensureResumed(
    sessionId: string,
    resumeThoughtLevel?: string,
    workspace?: CfWorkspaceRef,
    additionalDirectories?: string[],
    persistedMessages?: MessageWithParts[],
    onActivated?: (outcome: Extract<ColdSessionResumeOutcome, { status: "resumed" }>) => void,
  ): Promise<MessageWithParts[] | undefined> {
    const inFlight = this.flights.get(sessionId);
    if (inFlight) {
      this.host.onDebug?.(`cold resume joined existing flight session=${sessionId}`);
      return inFlight;
    }
    this.host.onDebug?.(`cold resume flight created session=${sessionId}`);
    const flight = this.resume(
      sessionId,
      resumeThoughtLevel,
      workspace,
      additionalDirectories,
      persistedMessages,
      onActivated,
    ).finally(() => {
      this.flights.delete(sessionId);
      this.host.onDebug?.(`cold resume flight cleared session=${sessionId}`);
    });
    this.flights.set(sessionId, flight);
    return flight;
  }

  clear(): void {
    this.flights.clear();
  }

  private async resume(
    sessionId: string,
    resumeThoughtLevel?: string,
    workspace?: CfWorkspaceRef,
    additionalDirectories?: string[],
    persistedMessages?: MessageWithParts[],
    onActivated?: (outcome: Extract<ColdSessionResumeOutcome, { status: "resumed" }>) => void,
  ): Promise<MessageWithParts[] | undefined> {
    const resume = this.host.resumePersistedSession;
    if (!resume) {
      throw new V4SubscribeSessionUnavailableError(
        sessionId,
        "fault.subscribe.sessionNotFound",
        `Session is not active: ${sessionId}`,
      );
    }
    let outcome: ColdSessionResumeOutcome;
    try {
      outcome = await resume.call(
        this.host,
        sessionId,
        resumeThoughtLevel,
        workspace,
        additionalDirectories,
        persistedMessages,
      );
    } catch (error) {
      this.host.onError?.("v4.subscribe.resume", error, {
        phase: "resumePersistedSession",
        sessionId,
      });
      throw new V4SubscribeSessionUnavailableError(
        sessionId,
        "fault.subscribe.resumeFailed",
        `Failed to resume persisted session ${sessionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
    if (outcome.status === "notFound") {
      throw new V4SubscribeSessionUnavailableError(
        sessionId,
        "fault.subscribe.sessionNotFound",
        `Session is not active and not persisted: ${sessionId}`,
      );
    }
    onActivated?.(outcome);
    return outcome.persistedMessages;
  }
}
