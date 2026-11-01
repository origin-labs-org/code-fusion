import {
  AMEND_WORKFLOW_TOOL_NAME,
  CREATE_WORKFLOW_TOOL_NAME,
  FILL_WORKFLOW_HOLE_TOOL_NAME,
  RESOLVE_WORKFLOW_QUESTION_TOOL_NAME,
  RESPOND_TO_COORDINATOR_TOOL_NAME,
  RESUME_WORKFLOW_RUN_TOOL_NAME,
  SAVE_WORKFLOW_TOOL_NAME,
} from "@origin-ai/cf-contracts";
import { EXPLORE_AGENT_ALLOWED_TOOLS } from "../../subagent/explore-tools.js";
import type { AgentRuntimeConfig } from "../types.js";
import { normalizeToolNameAlias } from "../../tool/tool-visibility.js";

const EXPLORE_AGENT_ALLOWED_TOOL_SET = new Set<string>(EXPLORE_AGENT_ALLOWED_TOOLS);

const WORKFLOW_CHILD_DISALLOWED_TOOLS = [
  CREATE_WORKFLOW_TOOL_NAME,
  AMEND_WORKFLOW_TOOL_NAME,
  SAVE_WORKFLOW_TOOL_NAME,
  RESUME_WORKFLOW_RUN_TOOL_NAME,
  //
  RESOLVE_WORKFLOW_QUESTION_TOOL_NAME,
  FILL_WORKFLOW_HOLE_TOOL_NAME,
] as const;

export function resolveRuntimeDisallowedTools(
  config: AgentRuntimeConfig,
): readonly string[] | undefined {
  if (config.taskType !== "workflow_child") return config.toolDisallowlist;

  const disallowed = new Set(config.toolDisallowlist ?? []);
  for (const toolName of WORKFLOW_CHILD_DISALLOWED_TOOLS) disallowed.add(toolName);
  return [...disallowed];
}

export function resolveRuntimeDynamicWorkflowToolsIncluded(runtime: {
  config: AgentRuntimeConfig;
  dynamicWorkflowToolsActivated: boolean;
}): boolean {
  return runtime.config.dynamicWorkflowEnabled !== false && runtime.dynamicWorkflowToolsActivated;
}

export function resolveBuiltInToolAllowlist(
  config: AgentRuntimeConfig,
): readonly string[] | undefined {
  const normalizedAllowlist = normalizeBuiltInToolAllowlist(config.toolAllowlist);

  if (config.toolset !== "explore") {
    return appendChildControlTool(config, normalizedAllowlist);
  }

  if (!normalizedAllowlist) {
    return appendChildControlTool(config, EXPLORE_AGENT_ALLOWED_TOOLS);
  }

  return appendChildControlTool(
    config,
    normalizedAllowlist.filter((toolName) => EXPLORE_AGENT_ALLOWED_TOOL_SET.has(toolName)),
  );
}

function appendChildControlTool(
  config: AgentRuntimeConfig,
  allowlist: readonly string[] | undefined,
): readonly string[] | undefined {
  if (!allowlist) {
    return allowlist;
  }

  if (config.taskType === "subagent_child") {
    if (allowlist.includes(RESPOND_TO_COORDINATOR_TOOL_NAME)) {
      return allowlist;
    }
    return [...allowlist, RESPOND_TO_COORDINATOR_TOOL_NAME];
  }

  return allowlist;
}

function normalizeBuiltInToolAllowlist(
  allowlist: readonly string[] | undefined,
): readonly string[] | undefined {
  return allowlist?.map((toolName) => normalizeToolNameAlias(toolName));
}
