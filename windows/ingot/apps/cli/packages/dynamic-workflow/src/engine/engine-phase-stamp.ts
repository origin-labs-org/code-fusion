

import type { RunEvent } from "./types.js";
import { refToString, WorkflowError } from "./types.js";

export type InstancePhases = ReadonlyMap<string, string>;

export function stampBirthPhase(event: RunEvent, instancePhases: InstancePhases): RunEvent {
  if (event.type === "actor-created") {
    const phaseName = instancePhases.get(refToString(event.actor));
    return phaseName === undefined ? event : { ...event, phaseName };
  }
  if (event.type === "node-queued") {
    const phaseName = instancePhases.get(refToString(event.instance));
    return phaseName === undefined ? event : { ...event, phaseName };
  }
  if (event.type === "node-dispatched" && event.actor !== undefined) {
    const phaseName = instancePhases.get(refToString(event.instance));
    const actorPhaseName = instancePhases.get(refToString(event.actor));
    if (phaseName === undefined && actorPhaseName === undefined) return event;
    return {
      ...event,
      ...(phaseName === undefined ? {} : { phaseName }),
      ...(actorPhaseName === undefined ? {} : { actorPhaseName }),
    };
  }
  if (event.type === "node-settled" && event.cached === true) {
    const phaseName = instancePhases.get(refToString(event.instance));
    return phaseName === undefined ? event : { ...event, phaseName };
  }
  if (event.type === "hole-reached") {
    const phaseName = instancePhases.get(refToString(event.instance));
    return phaseName === undefined ? event : { ...event, phaseName };
  }
  return event;
}

export function enrichProviderStopPhase(
  error: WorkflowError,
  instancePhases: InstancePhases,
): WorkflowError {
  const details = error.providerStop;
  if (details === undefined || details.subagent === undefined || details.phase !== undefined) {
    return error;
  }
  const phase = instancePhases.get(details.subagent);
  if (phase === undefined) return error;
  return new WorkflowError(error.code, error.message, {
    providerStop: { ...details, phase },
    cause: (error as { cause?: unknown }).cause,
  });
}
