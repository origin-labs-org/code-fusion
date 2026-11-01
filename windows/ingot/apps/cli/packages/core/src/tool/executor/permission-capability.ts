import type { ModelToolSideEffectScope } from "@origin-ai/cf-contracts";
import type { PermissionToolCapability } from "../../permission/service.js";
import type { ToolEntry, ToolRuntimePermissionCapabilityContext } from "../types.js";
import type { ToolExecutorDeps } from "./types.js";

export function resolveRuntimePermissionCapability(
  entry: ToolEntry,
  input: unknown,
  context: ToolRuntimePermissionCapabilityContext,
): PermissionToolCapability {
  const runtimeCapability = entry.resolvePermissionCapability?.(input, context);
  return {
    ...entry.metadata,
    ...runtimeCapability,
    // capability group is provenance, not a runtime/model-controlled override.
    permissionCapabilityGroup: entry.permissionCapabilityGroup,
    permission: {
      ...entry.permission,
      ...runtimeCapability?.permission,
    },
  };
}

export function resolveToolCallCapabilityFlags(
  deps: ToolExecutorDeps,
  entry: ToolEntry,
  input: unknown,
): { readOnly?: boolean; sideEffectScope?: ModelToolSideEffectScope } {
  const capability = resolveRuntimePermissionCapability(
    entry,
    input,
    resolveRuntimePermissionContext(deps),
  );
  return { readOnly: capability.readOnly, sideEffectScope: capability.sideEffectScope };
}

export function resolveRuntimePermissionContext(
  deps: ToolExecutorDeps,
): ToolRuntimePermissionCapabilityContext {
  return {
    runtimeScope: deps.runtimeScope,
    workingDirectory: deps.getWorkingDirectory(),
    workspaceRoot: deps.getWorkspaceRoot(),
  };
}
