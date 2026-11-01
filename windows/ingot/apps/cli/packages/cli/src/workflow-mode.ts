import {
  DYNAMIC_WORKFLOW_MODES,
  normalizeDynamicWorkflowMode,
  type DynamicWorkflowMode,
} from "@origin-ai/cf-shared";

export const DEFAULT_CLI_WORKFLOW_MODE: DynamicWorkflowMode = "disabled";

export const WORKFLOW_MODE_SCOPE_ERROR =
  "--workflow-mode can only be used with --prompt, --target, or tui.";

export const WORKFLOW_DISABLED_NOTICE =
  "Dynamic workflows are disabled in this session. Restart with --workflow-mode onDemand or --workflow-mode alwaysOn to use them.";

export type CliWorkflowRuntimeConfig = {
  dynamicWorkflowEnabled: boolean;
  dynamicWorkflowToolsOnDemand: boolean;
};

export function normalizeWorkflowModeOption(
  value: string | undefined,
): DynamicWorkflowMode | undefined {
  if (value === undefined) return undefined;
  const mode = normalizeDynamicWorkflowMode(value);
  if (mode !== undefined) return mode;
  throw new Error(
    `Unsupported --workflow-mode value: ${value}. Supported modes: ${DYNAMIC_WORKFLOW_MODES.join(", ")}.`,
  );
}

export function resolveWorkflowModeRuntimeConfig(
  mode: DynamicWorkflowMode,
): CliWorkflowRuntimeConfig {
  return {
    dynamicWorkflowEnabled: mode !== "disabled",
    dynamicWorkflowToolsOnDemand: mode === "onDemand",
  };
}

export function isWorkflowModeEnabled(mode: DynamicWorkflowMode | undefined): boolean {
  return mode !== "disabled";
}
