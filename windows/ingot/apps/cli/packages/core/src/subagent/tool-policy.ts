import {
  ENTER_PLAN_MODE_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
} from "@origin-ai/cf-contracts";
import { filterDisallowedToolNames } from "../tool/tool-visibility.js";

export const SUBAGENT_CHILD_FORCED_DISALLOWED_TOOLS = [
  ENTER_PLAN_MODE_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
] as const;

export function buildSubagentChildDisallowRules(
  disallowedTools: readonly string[] | undefined,
): readonly string[] {
  return [
    ...SUBAGENT_CHILD_FORCED_DISALLOWED_TOOLS,
    ...(disallowedTools ?? []),
  ];
}

export function filterSubagentChildToolNames(
  toolNames: readonly string[],
  disallowedTools: readonly string[] | undefined,
): readonly string[] {
  return filterDisallowedToolNames(
    toolNames,
    buildSubagentChildDisallowRules(disallowedTools),
  );
}
