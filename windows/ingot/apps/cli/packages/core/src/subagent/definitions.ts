import { normalizeAgentProfiles, type AgentProfile } from "./profile.js";
import type { TraceContext } from "@origin-ai/cf-contracts";

export interface AgentDefinitionsSnapshot {
  readonly activeAgents: readonly Readonly<AgentProfile>[];
}

export type GetAgentDefinitions = () => AgentDefinitionsSnapshot;

export type LoadAgentDefinitions = (input: {
  signal: AbortSignal;
  traceContext: TraceContext;
}) => Promise<AgentDefinitionsSnapshot>;

export function createTurnAgentDefinitions(
  getInitial: GetAgentDefinitions,
  load?: LoadAgentDefinitions,
) {
  let snapshot: AgentDefinitionsSnapshot | undefined;
  return {
    get: (): AgentDefinitionsSnapshot => snapshot ?? getInitial(),
    async prepare(input: Parameters<LoadAgentDefinitions>[0]): Promise<void> {
      if (!load) return;
      const next = await load(input);
      input.signal.throwIfAborted();
      snapshot = structuredClone(next);
    },
  };
}

export function createAgentDefinitionsReader(
  profiles: readonly AgentProfile[],
  options: Parameters<typeof normalizeAgentProfiles>[1] = {},
): GetAgentDefinitions {
  const snapshot: AgentDefinitionsSnapshot = {
    activeAgents: normalizeAgentProfiles(profiles, options),
  };
  return () => snapshot;
}
