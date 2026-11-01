
import { $getRoot, $getSelection, $isRangeSelection, $isTextNode } from "lexical";
import type { AgentSummary, Locale, SkillSummary, CfSlashCommand } from "@origin-ai/cf-shared";
import type { MentionItem } from "@/mentions/mentionTypes.js";
import { mapSubagentsToMentionItemsForTest } from "@/mentions/providers/subagentsMentionProvider.js";
import { mapSkillsToMentionItemsForTest } from "@/mentions/providers/skillsMentionProvider.js";
import {
  extractActivePromptInputTrigger,
  getActivePromptInputTokenTailLength,
} from "./lib/promptInputTriggers.js";
import type { PromptInputSuggestionItem } from "./lib/promptInputTriggers.js";

export interface SlashCommandPluginProps {
  container?: HTMLElement | null;
  workspacePath: string;
  workspaceIdentity?: string;
  
  sessionId?: string | null;
  disabled?: boolean;
  excludedCommandNames?: readonly string[];
  
  appCommands?: readonly AppSlashCommand[];
}

export interface AppSlashCommand {
  
  value: string;
  
  label?: string;
  
  description: string;
  
  keywords?: readonly string[];
  
  run: () => void;
}

const APP_SLASH_SUGGESTION_ID_PREFIX = "app-slash:";

export function buildAppSlashCommandSuggestions(
  commands: readonly AppSlashCommand[],
): PromptInputSuggestionItem[] {
  return commands.flatMap((command) => {
    const value = normalizeSlashCommandValue(command.value);
    if (!value) {
      return [];
    }
    return [
      {
        id: `${APP_SLASH_SUGGESTION_ID_PREFIX}${value}`,
        trigger: "/",
        value,
        label: command.label ?? `/${value}`,
        description: command.description,
        keywords: [...new Set([value, command.description, ...(command.keywords ?? [])])],
      },
    ];
  });
}

export function isAppSlashCommandSuggestion(suggestion: PromptInputSuggestionItem): boolean {
  return suggestion.id.startsWith(APP_SLASH_SUGGESTION_ID_PREFIX);
}

export function shouldOfferSideSlashCommand(options: {
  isDraft: boolean;
  selectionSideChat: boolean;
  readOnly: boolean;
  isMobileViewport: boolean;
}): boolean {
  return (
    !options.isDraft && !options.selectionSideChat && !options.readOnly && !options.isMobileViewport
  );
}

export function normalizeSlashCommandValue(name: string): string {
  return name.trim().replace(/^\/+/, "");
}

export function buildSlashSuggestions(commands: CfSlashCommand[]): PromptInputSuggestionItem[] {
  return commands.flatMap((command) => {
    const value = normalizeSlashCommandValue(command.name);
    if (!value || value.toLowerCase() === "plan") {
      return [];
    }
    return [
      {
        id: `slash:${value}`,
        trigger: "/",
        value,
        label: command.inputHint?.trim() || `/${value}`,
        description: command.description,
        keywords: [...new Set([value, command.name, command.description, command.inputHint ?? ""])],
      },
    ];
  });
}

export function buildSubagentSuggestions(
  agents: Array<
    Pick<
      AgentSummary,
      "id" | "name" | "description" | "path" | "scope" | "source" | "enabled" | "modelSelection"
    >
  >,
): PromptInputSuggestionItem[] {
  return mapSubagentsToMentionItemsForTest(agents).map((item) =>
    mapSubagentMentionItemToSuggestion(item),
  );
}

export function buildSkillSuggestions(
  skills: Array<
    Pick<SkillSummary, "id" | "name" | "description" | "path" | "scope" | "pluginName">
  >,
  locale?: Locale,
): PromptInputSuggestionItem[] {
  return mapSkillsToMentionItemsForTest(skills, locale).map((item) => ({
    id: item.id,
    trigger: "/",
    value: item.value,
    label: `$${item.value}`,
    description: item.description,
    keywords: [...new Set([...(item.keywords ?? []), "skill", "skills", item.value])],
    data: item.data,
  }));
}

function mapSubagentMentionItemToSuggestion(item: MentionItem): PromptInputSuggestionItem {
  return {
    id: item.id,
    trigger: "/",
    value: item.value,
    label: item.label,
    description: item.description,
    keywords: [...new Set([...(item.keywords ?? []), "subagent", "agent"])],
    data: item.data,
  };
}

export function replaceActiveSlashToken(
  textBeforeCursor: string,
  textAfterCursor: string,
  replacementToken: string,
) {
  const activeTrigger = extractActivePromptInputTrigger(textBeforeCursor);
  if (!activeTrigger || activeTrigger.trigger !== "/") {
    return null;
  }

  const tokenStart = textBeforeCursor.length - activeTrigger.query.length - 1;
  const tailLength = getActivePromptInputTokenTailLength(
    activeTrigger,
    textAfterCursor,
    replacementToken,
  );
  const prefix = textBeforeCursor.slice(0, tokenStart);
  const suffix = textAfterCursor.slice(tailLength);
  return {
    cursorOffset: prefix.length + replacementToken.length + 1,
    text: `${prefix}${replacementToken} ${suffix}`,
  };
}

export function getTextAroundCursor() {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return null;
  }

  const anchor = selection.anchor;
  if (anchor.type !== "text") {
    return {
      textAfterCursor: "",
      textBeforeCursor: $getRoot().getTextContent(),
    };
  }

  const node = anchor.getNode();
  if (!$isTextNode(node)) {
    return null;
  }

  const textContent = node.getTextContent();
  return {
    textAfterCursor: textContent.slice(anchor.offset),
    textBeforeCursor: textContent.slice(0, anchor.offset),
  };
}
