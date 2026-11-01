import {
  parseAgentProfileFromMarkdown,
  type AgentProfile,
  type AgentProfileParseDiagnostic,
  resolveSubagentRuntimeProfiles,
  type SubagentRuntimeConfig,
} from "@origin-ai/cf-shared";

import type { RuntimeSubagentConfiguration } from "./contract.js";

export function parseRuntimeSubagentConfig(configuration: RuntimeSubagentConfiguration) {
  const profiles: AgentProfile[] = [];
  const diagnostics: AgentProfileParseDiagnostic[] = [];
  for (const document of configuration.documents) {
    const result = parseAgentProfileFromMarkdown(document);
    if (result.diagnostic) diagnostics.push(result.diagnostic);
    if (!result.profile) continue;
    profiles.push(
      document.namespace
        ? { ...result.profile, name: `${document.namespace}/${result.profile.name}` }
        : result.profile,
    );
  }
  return {
    ...resolveSubagentRuntimeProfiles(profiles, configuration.state),
    diagnostics,
  };
}

export function subagentProfilesFromSnapshot(snapshot: SubagentRuntimeConfig) {
  return snapshot.kind === "ready"
    ? snapshot
    : {
        profiles: [],
        builtInModelSelectionOverrides: {},
        pluginAgentModelSelectionOverrides: {},
      };
}
