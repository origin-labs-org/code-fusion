import type { PromptInputTrigger } from "@/lib/promptInputTriggers.js";

export type MentionPanelGroupId = "plugins" | "files" | "sessions" | "whiteboards" | "skills";
export type SessionMentionWorkspaceScope = "current-workspace" | "same-authority-workspaces";

const CONTEXT_GROUP_ORDER: readonly MentionPanelGroupId[] = [
  "plugins",
  "files",
  "sessions",
  "whiteboards",
];
const SESSION_GROUP_ORDER: readonly MentionPanelGroupId[] = ["sessions"];
const SKILL_GROUP_ORDER: readonly MentionPanelGroupId[] = ["skills"];

export function getMentionPanelGroupOrder(
  trigger: PromptInputTrigger | null | undefined,
): readonly MentionPanelGroupId[] {
  if (trigger === "@") {
    return CONTEXT_GROUP_ORDER;
  }
  if (trigger === "#") {
    return SESSION_GROUP_ORDER;
  }
  if (trigger === "$") {
    return SKILL_GROUP_ORDER;
  }
  return [];
}

export function getSessionMentionWorkspaceScope(
  trigger: PromptInputTrigger | null | undefined,
): SessionMentionWorkspaceScope {
  return trigger === "#" ? "same-authority-workspaces" : "current-workspace";
}
