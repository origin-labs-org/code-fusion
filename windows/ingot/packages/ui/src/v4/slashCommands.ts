export type V4VisibleSlashCommand =
  | {
      kind: "compact";
      displayText: string;
    }
  | {
      kind: "sendGoalCommand";
      objective: string;
      displayText: string;
    }
  | {
      kind: "resumeGoal";
      displayText: string;
    }
  | {
      kind: "emptyGoal";
      displayText: string;
    }
  | {
      kind: "unsupportedGoal";
      action: string;
      displayText: string;
    };

export interface V4VisibleSlashCommandParseOptions {
  contextAttachmentCount?: number;
}

export interface SelectionSideSlashCommand {
  command: "side" | "btw";
  text: string;
  displayText: string;
}

export interface SelectionSideSlashCommandParseOptions {
  contextAttachmentCount?: number;
  
  enabledCommandNames?: readonly string[];
}

const GOAL_COMMAND_RE = /^\/(?:goal|target)(?:\s|$)/i;

export function parseV4VisibleSlashCommand(
  content: string,
  attachments: readonly unknown[] = [],
  options: V4VisibleSlashCommandParseOptions = {},
): V4VisibleSlashCommand | null {
  const displayText = content.trim();
  if (!displayText.startsWith("/")) return null;
  const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(displayText);
  if (!match) return null;
  const commandName = match[1]?.toLowerCase() ?? "";
  const args = match[2]?.trim() ?? "";

  if (attachments.length > 0 || (options.contextAttachmentCount ?? 0) > 0) {
    return null;
  }

  if (commandName === "compact" || commandName === "compress") {
    return { kind: "compact", displayText };
  }
  if (commandName !== "goal" && commandName !== "target") {
    return null;
  }
  if (!args) return { kind: "emptyGoal", displayText };

  const action = args.split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  if (action === "resume") return { kind: "resumeGoal", displayText };
  if (action === "pause" || action === "clear" || action === "show") {
    return { kind: "unsupportedGoal", action, displayText };
  }
  const objective = action === "replace" ? args.replace(/^replace\s*/i, "").trim() : args;
  if (!objective) return { kind: "emptyGoal", displayText };
  return { kind: "sendGoalCommand", objective, displayText };
}

export function parseSelectionSideSlashCommand(
  content: string,
  attachments: readonly unknown[] = [],
  options: SelectionSideSlashCommandParseOptions = {},
): SelectionSideSlashCommand | null {
  if (attachments.length > 0 || (options.contextAttachmentCount ?? 0) > 0) return null;
  const displayText = content.trim();
  const match = /^\/(side|btw)(?:\s+([\s\S]*))?$/i.exec(displayText);
  if (!match) return null;
  const command = match[1]?.toLowerCase() as SelectionSideSlashCommand["command"] | undefined;
  const enabledNames = options.enabledCommandNames;
  if (
    enabledNames &&
    !enabledNames.some((name) => name.trim().replace(/^\/+/, "").toLowerCase() === command)
  ) {
    return null;
  }
  const text = match[2]?.trim() ?? "";
  if (!text || !command) return null;
  return { command, text, displayText };
}

export function v4QueuedCommandText(kind: "sendText" | "sendGoalCommand", text: string): string {
  if (kind !== "sendGoalCommand") return text;
  const trimmed = text.trim();
  if (!trimmed) return text;
  return GOAL_COMMAND_RE.test(trimmed) ? text : `/goal ${trimmed}`;
}

export function extractV4GoalObjective(text: string): string {
  const parsed = parseV4VisibleSlashCommand(v4QueuedCommandText("sendGoalCommand", text));
  return parsed?.kind === "sendGoalCommand" ? parsed.objective : text.trim();
}
