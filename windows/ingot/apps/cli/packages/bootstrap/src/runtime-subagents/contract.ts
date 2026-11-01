import type { SubagentRuntimeState } from "@origin-ai/cf-shared";

export interface RuntimeSubagentConfiguration {
  documents: { content: string; path: string; namespace?: string; source: "user" | "project" }[];
  state: SubagentRuntimeState;
}
