// ============================================================
// ============================================================

import type { RuntimeMessageEntry } from "./message-history.js";

const SKILL_TOOL_NAME = "Skill";

export function sessionHasLoadedSkill(
  entries: readonly RuntimeMessageEntry[],
  skillName: string,
): boolean {
  const pendingCallIds = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === "attachment") continue;
    const message = entry.message;
    if (message.role === "assistant") {
      for (const call of message.toolCalls ?? []) {
        if (call.name === SKILL_TOOL_NAME && skillInputNames(call.input) === skillName) {
          pendingCallIds.add(call.id);
        }
      }
      continue;
    }
    if (
      message.role === "tool" &&
      message.toolCallId !== undefined &&
      pendingCallIds.has(message.toolCallId) &&
      message.isError !== true
    ) {
      return true;
    }
  }
  return false;
}

function skillInputNames(input: unknown): string | undefined {
  if (input === null || typeof input !== "object") return undefined;
  const fields = input as { skill?: unknown; name?: unknown };
  if (typeof fields.skill === "string") return fields.skill;
  if (typeof fields.name === "string") return fields.name;
  return undefined;
}
