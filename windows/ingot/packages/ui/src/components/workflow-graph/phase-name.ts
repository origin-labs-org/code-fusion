import { IMPLICIT_PHASE_ID, UNPHASED_PHASE_ID } from "./types.js";
import type { LaneNameFormatter } from "./lane-name.js";

export interface PhaseNaming {
  id: string;
  
  name?: string;
}

export function phaseDisplayName(phase: PhaseNaming, formatMessage: LaneNameFormatter): string {
  if (phase.name !== undefined) return phase.name;
  if (phase.id === UNPHASED_PHASE_ID) {
    return formatMessage({ id: "chat.toolCall.workflow.graph.phase.unphased" });
  }
  if (phase.id === IMPLICIT_PHASE_ID) {
    return formatMessage({ id: "chat.toolCall.workflow.graph.phase.workflow" });
  }
  return phase.id;
}

export const DISPLAY_PHASE_NAME_BOUND = 128;

export function phaseNameMatches(
  displayName: string | undefined,
  runtimeName: string | undefined,
): boolean {
  if (displayName === undefined || runtimeName === undefined) return false;
  if (displayName === runtimeName) return true;
  return displayName.length >= DISPLAY_PHASE_NAME_BOUND && runtimeName.startsWith(displayName);
}
