// ============================================================
// ============================================================

import {
  boundDynamicWorkflowRunEventPayload,
  type DynamicWorkflowRunEvent,
  type DynamicWorkflowRunProgressPayload,
} from "@origin-ai/cf-contracts";
import type { ActorRef, RunEvent } from "@origin-ai/cf-dynamic-workflow";
import { isResumableSettlement } from "./dynamic-workflow-run-observation.js";
import { mintActorSessionId } from "./workflow-driver.js";

export function toProtocolEvent(sequence: number, event: RunEvent): DynamicWorkflowRunEvent {
  const { type, ...rest } = event;
  const { payload, truncated } = boundDynamicWorkflowRunEventPayload(
    rest as Record<string, unknown>,
  );
  return { sequence, type, payload, ...(truncated ? { truncated } : {}) };
}

export function toProgressPayload(input: {
  event: RunEvent;
  runId: string;
  sequence: number;
  toolCallId?: string;
  
  launchInputId?: string;
  
  resumedFrom?: string;
  
  concurrencyCeiling?: number;
  
  subagentModel?: string;
  
  modelBindings?: Record<string, string>;
  
  holeTypeOf?: (siteId: string) => string | undefined;
  
  reachedAt?: number;
}): DynamicWorkflowRunProgressPayload {
  const {
    event,
    runId,
    sequence,
    toolCallId,
    launchInputId,
    resumedFrom,
    concurrencyCeiling,
    subagentModel,
    modelBindings,
    holeTypeOf,
    reachedAt,
  } = input;
  const protocolEvent = toProtocolEvent(sequence, event);
  const actorRef = actorSessionRefOf(event);
  return {
    runId,
    ...(toolCallId === undefined ? {} : { toolCallId }),
    sequence,
    eventType: protocolEvent.type,
    payload:
      event.type === "run-settled" && isResumableSettlement(event.status, event.stopReason)
        ? { ...protocolEvent.payload, resumable: true }
        : event.type === "run-started"
          ? {
              ...protocolEvent.payload,
              ...(resumedFrom === undefined ? {} : { resumedFrom }),
              ...(concurrencyCeiling === undefined ? {} : { concurrencyCeiling }),
              ...(subagentModel === undefined ? {} : { subagentModel }),
            }
          : event.type === "run-caps-changed"
            ? {
                ...protocolEvent.payload,
                ...(concurrencyCeiling === undefined ? {} : { concurrencyCeiling }),
              }
            : event.type === "actor-created"
              ? withActorModel(protocolEvent.payload, "model", event.persona?.model, modelBindings)
              : event.type === "node-dispatched"
                ? withActorModel(
                    protocolEvent.payload,
                    "actorModel",
                    event.actorPersonaModel,
                    modelBindings,
                  )
                : event.type === "hole-reached"
                  ? withHoleFacts(
                      protocolEvent.payload,
                      holeTypeOf?.(event.instance.siteId),
                      reachedAt,
                    )
                  : protocolEvent.payload,
    ...(protocolEvent.truncated ? { truncated: true } : {}),
    ...(actorRef === undefined ? {} : { actorSessionId: mintActorSessionId(runId, actorRef) }),
    ...((event.type === "actor-created" || event.type === "run-settled") &&
    launchInputId !== undefined
      ? { launchInputId }
      : {}),
  };
}

function withActorModel(
  payload: Record<string, unknown>,
  key: "model" | "actorModel",
  personaModel: string | undefined,
  modelBindings: Record<string, string> | undefined,
): Record<string, unknown> {
  const model = personaModel === undefined ? undefined : modelBindings?.[personaModel];
  return model === undefined ? payload : { ...payload, [key]: model };
}

function withHoleFacts(
  payload: Record<string, unknown>,
  type: string | undefined,
  reachedAt: number | undefined,
): Record<string, unknown> {
  return {
    ...payload,
    ...(type === undefined ? {} : { type }),
    ...(reachedAt === undefined ? {} : { reachedAt }),
  };
}

function actorSessionRefOf(event: RunEvent): ActorRef | undefined {
  if (event.type === "actor-created") return event.actor;
  if (event.type === "node-dispatched") return event.actor;
  if (event.type === "node-settled" && event.cached === true) return event.actor;
  return undefined;
}
