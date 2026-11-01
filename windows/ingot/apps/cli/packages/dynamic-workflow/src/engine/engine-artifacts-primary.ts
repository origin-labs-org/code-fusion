

import type { EngineState } from "./engine-state.js";
import type { InstanceRef } from "./types.js";
import { refToString } from "./types.js";

export function primaryArtifactId(state: EngineState): string | undefined {
  for (const [id, idState] of state.artifacts) if (idState.primary) return id;
  return undefined;
}

export function primaryConflict(
  state: EngineState,
  id: string,
  primary: boolean,
): string | undefined {
  if (!primary) return undefined;
  const holder = primaryArtifactId(state);
  return holder === undefined || holder === id ? undefined : holder;
}

export function primaryConflictMessage(
  id: string,
  holder: string,
  fix: string,
  instance: InstanceRef | undefined,
): string {
  const where = instance === undefined ? "" : ` (at ${refToString(instance)})`;
  return (
    `Cannot mark "${id}" as primary${where}: "${holder}" is already this run's primary artifact. ` +
    `A run has one deliverable; ${fix}, or publish it as a new version of "${holder}".`
  );
}
