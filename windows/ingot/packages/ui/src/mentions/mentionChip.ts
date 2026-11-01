import type { MentionCategory } from "@/mentions/mentionTypes.js";

export const PROMPT_MENTION_BASE_CLASS_NAME =
  "inline-flex cursor-default items-center gap-1 align-top text-ui-base leading-5 font-medium";

export function getPromptMentionVariantClassName(category: MentionCategory): string {
  if (category === "skills") {
    return "text-skill-node-foreground";
  }
  if (category === "subagents") {
    return "text-subagent-node-foreground";
  }
  if (category === "commands") {
    return "text-command-node-foreground capitalize";
  }
  if (category === "sessions") {
    return "text-session-node-foreground";
  }
  if (category === "plugins") {
    return "text-plugin-node-foreground";
  }
  if (category === "whiteboards") {
    return "text-file-node-foreground";
  }
  return "text-file-node-foreground";
}
