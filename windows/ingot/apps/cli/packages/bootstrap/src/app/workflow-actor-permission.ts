// ============================================================
// ============================================================
//

import type { CollaborationMode } from "@origin-ai/cf-contracts";
import { refToString, type ActorRef, type PersonaSpec } from "@origin-ai/cf-dynamic-workflow";

export type WorkflowSubagentPermissionMode = Exclude<CollaborationMode, "plan">;

const RECORDABLE_MODES: ReadonlySet<string> = new Set<WorkflowSubagentPermissionMode>([
  "build",
  "edit",
  "yolo",
  "guarded",
  "auto",
]);

const UNRECORDED_MODE = "yolo" satisfies CollaborationMode;

const ANONYMOUS_ACTOR_NAME = "subagent";

export function workflowSubagentPermissionModeOf(
  sessionMode: CollaborationMode | undefined,
): WorkflowSubagentPermissionMode | undefined {
  if (sessionMode === undefined) return undefined;
  return sessionMode === "plan" ? "build" : sessionMode;
}

export function workflowSubagentPermissionModeField(sessionMode: CollaborationMode | undefined): {
  subagentPermissionMode?: WorkflowSubagentPermissionMode;
} {
  const mode = workflowSubagentPermissionModeOf(sessionMode);
  return mode === undefined ? {} : { subagentPermissionMode: mode };
}

export function parseWorkflowSubagentPermissionMode(
  raw: unknown,
): WorkflowSubagentPermissionMode | undefined {
  return typeof raw === "string" && RECORDABLE_MODES.has(raw)
    ? (raw as WorkflowSubagentPermissionMode)
    : undefined;
}

interface WorkflowActorPermissionPolicy {
  mode: CollaborationMode;
}

export function workflowActorPermissionPolicy(
  subagentPermissionMode: WorkflowSubagentPermissionMode | undefined,
): WorkflowActorPermissionPolicy {
  return { mode: subagentPermissionMode ?? UNRECORDED_MODE };
}

export function workflowActorInteractionDescription(input: {
  actor: ActorRef;
  persona: Pick<PersonaSpec, "name">;
}): string {
  return `${input.persona.name ?? ANONYMOUS_ACTOR_NAME} (${refToString(input.actor)})`;
}
