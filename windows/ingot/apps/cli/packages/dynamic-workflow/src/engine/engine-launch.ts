// ============================================================
// ============================================================

import type { RunEvent } from "./types.js";

export interface RunLaunchConfig {
  inputId: string;
  phaseNames?: string[];
  subagentModel?: string;
  
  modelBindings?: Record<string, string>;
  
  subagentPermissionMode?: string;
  
  scriptPath?: string;
  phaseAlongside?: number[][];
  
  holes?: number[];
}

export function runLaunchedEvent(
  launch: RunLaunchConfig,
  origin: { toolCallId?: string | undefined; parentSessionId?: string | undefined },
): RunEvent {
  const {
    inputId,
    phaseNames,
    subagentModel,
    subagentPermissionMode,
    modelBindings,
    scriptPath,
    phaseAlongside,
    holes,
  } = launch;
  return {
    type: "run-launched",
    inputId,
    ...(origin.toolCallId === undefined ? {} : { toolCallId: origin.toolCallId }),
    ...(origin.parentSessionId === undefined ? {} : { parentSessionId: origin.parentSessionId }),
    ...(phaseNames === undefined ? {} : { phaseNames }),
    ...(subagentModel === undefined ? {} : { subagentModel }),
    ...(subagentPermissionMode === undefined ? {} : { subagentPermissionMode }),
    ...(modelBindings === undefined ? {} : { modelBindings }),
    ...(scriptPath === undefined ? {} : { scriptPath }),
    ...(phaseAlongside === undefined ? {} : { phaseAlongside }),
    ...(holes === undefined ? {} : { holes }),
  };
}
