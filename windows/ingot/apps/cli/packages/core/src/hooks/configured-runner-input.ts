import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWorkspaceHookTimeoutMs } from "@origin-ai/cf-shared/workspace-hook-discovery";
import {
  CoreErrorType,
  HookEventName,
  createCoreError,
  type HookConfig,
  type HookInput,
  type HookPluginContext,
} from "@origin-ai/cf-contracts";

export async function createCompatibleHookStdin(input: HookInput): Promise<{
  cleanup: () => Promise<void>;
  value: string;
}> {
  const compatible: Record<string, unknown> = {
    ...input,
    agent_type: input.agentName,
    hook_event_name: input.hookEventName,
    permission_mode: input.mode,
    session_id: input.sessionId,
  };
  const tempDir = await mkdtemp(join(tmpdir(), "cf-hook-"));
  const transcriptPath = join(tempDir, "transcript.jsonl");
  await writeFile(transcriptPath, formatTranscript(input), "utf8");
  compatible.transcript_path = transcriptPath;
  compatible.transcriptPath = transcriptPath;

  if ("toolName" in input) {

    compatible.tool_name = input.toolName;
    compatible.tool_input = input.toolInput;
    compatible.tool_use_id = input.toolCallId;
  }

  switch (input.hookEventName) {
    case HookEventName.PermissionRequest:
      compatible.permission_suggestions = input.permissionSuggestions;
      break;
    case HookEventName.PostToolUse:
      compatible.tool_response = input.toolResponse;
      break;
    case HookEventName.PostToolUseFailure:

      compatible.error_details = input.error;
      compatible.error = input.error.message;
      compatible.is_interrupt = input.isInterrupt;
      break;
    case HookEventName.Stop:
      compatible.last_assistant_message = input.responseText ?? input.responsePreview;
      compatible.stop_hook_active = input.stopHookActive;
      break;
    case HookEventName.SessionStart:
    case HookEventName.UserPromptSubmit:
    case HookEventName.PreToolUse:
      break;
  }

  return {
    value: `${JSON.stringify(compatible)}\n`,
    cleanup: async () => {
      await rm(tempDir, { force: true, recursive: true });
    },
  };
}

export function resolveHookTimeoutMs(hook: HookConfig, defaultTimeoutMs: number): number {
  return resolveWorkspaceHookTimeoutMs(hook, defaultTimeoutMs);
}

export function createPluginEnvOverlay(
  plugin: HookPluginContext | undefined,
  input: HookInput,
  workingDirectory: string,
) {
  const set: Record<string, string> = {
    CLAUDE_CODE_SESSION_ID: input.sessionId,
    CLAUDE_PROJECT_DIR: input.cwd || workingDirectory,
    CLAUDE_SESSION_ID: input.sessionId,
    CF_PROJECT_DIR: input.cwd || workingDirectory,
    CF_SESSION_ID: input.sessionId,
  };
  if (!plugin) return { set };
  return {
    set: {
      ...set,
      CLAUDE_PLUGIN_DATA: plugin.dataPath,
      CLAUDE_PLUGIN_ROOT: plugin.rootPath,
      CF_PLUGIN_DATA: plugin.dataPath,
      CF_PLUGIN_ID: plugin.id,
      CF_PLUGIN_NAME: plugin.name,
      CF_PLUGIN_ROOT: plugin.rootPath,
    },
  };
}

export function expandPluginVariables(
  value: string,
  plugin: HookPluginContext | undefined,
  input: HookInput,
  workingDirectory: string,
): string {
  const replacements: Record<string, string> = {
    CLAUDE_CODE_SESSION_ID: input.sessionId,
    CLAUDE_PROJECT_DIR: input.cwd || workingDirectory,
    CLAUDE_SESSION_ID: input.sessionId,
    CF_PROJECT_DIR: input.cwd || workingDirectory,
    CF_SESSION_ID: input.sessionId,
  };
  if (plugin) {
    replacements.CLAUDE_PLUGIN_DATA = plugin.dataPath;
    replacements.CLAUDE_PLUGIN_ROOT = plugin.rootPath;
    replacements.CF_PLUGIN_DATA = plugin.dataPath;
    replacements.CF_PLUGIN_ROOT = plugin.rootPath;
  }
  return value.replace(
    /\$\{(CLAUDE_CODE_SESSION_ID|CLAUDE_PLUGIN_DATA|CLAUDE_PLUGIN_ROOT|CLAUDE_PROJECT_DIR|CLAUDE_SESSION_ID|CLAUDE_SKILL_DIR|CF_PLUGIN_DATA|CF_PLUGIN_ROOT|CF_PROJECT_DIR|CF_SESSION_ID|CF_SKILL_DIR)\}/gu,
    (_match, key: string) => {
      if (key === "CLAUDE_SKILL_DIR" || key === "CF_SKILL_DIR") {
        throw createCoreError(
          CoreErrorType.ConfigurationError,
          `Hook variable requires a skill context: ${key}`,
          {
            context: {
              hookEventName: input.hookEventName,
              variable: key,
            },
            recoverable: true,
          },
        );
      }
      return replacements[key] ?? _match;
    },
  );
}

function formatTranscript(input: HookInput): string {
  if (input.hookEventName === HookEventName.Stop) {
    return formatMessageLine("assistant", input.responseText ?? input.responsePreview);
  }
  if (input.hookEventName === HookEventName.UserPromptSubmit) {
    return formatMessageLine("user", input.prompt);
  }
  return "";
}

function formatMessageLine(role: "assistant" | "user", text: string): string {
  return `${JSON.stringify({
    message: {
      content: [{ text, type: "text" }],
      role,
    },
  })}\n`;
}
