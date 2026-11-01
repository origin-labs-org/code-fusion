import {
  expandCustomCommandPrompt,
  expandCustomCommandTemplate,
  formatCustomCommandPrompt,
  type ExecutionPort,
  type SessionId,
  type TraceContext,
} from "@origin-ai/cf-contracts";
import {
  loadCfCustomCommand,
  type ListCfCustomCommandsOptions,
} from "./custom-commands.js";
import { expandCustomCommandShellSyntax } from "./custom-command-shell-expansion.js";
import { isReservedCfSlashCommandName } from "./slash-command-surface.js";

const CUSTOM_COMMAND_NOT_FOUND_PATTERN = /not found/i;
const PROMPT_CUSTOM_COMMAND_PATTERN = /^\/([^\s]+)(?:\s+([\s\S]*))?$/;

export interface ResolveCfCustomCommandPromptOptions extends ListCfCustomCommandsOptions {
  executionPort?: ExecutionPort;
  sessionId?: SessionId;
  signal?: AbortSignal;
  traceContext?: TraceContext;
}

export async function resolveCfCustomCommandPrompt(
  input: string,
  options: ResolveCfCustomCommandPromptOptions = {},
): Promise<string | undefined> {
  const invocation = parsePromptCustomCommandInvocation(input);
  if (!invocation || isReservedCfSlashCommandName(invocation.name)) {
    return undefined;
  }

  try {
    const command = await loadCfCustomCommand({
      ...options,
      name: invocation.name,
    });
    if (options.executionPort) {
      //
      const expanded = expandCustomCommandTemplate({
        args: invocation.args,
        command,
      });
      const body = await expandCustomCommandShellSyntax({
        command,
        content: expanded.body,
        executionPort: options.executionPort,
        sessionId: options.sessionId,
        signal: options.signal,
        traceContext: options.traceContext,
        workingDirectory: options.workingDirectory ?? process.cwd(),
      });
      return formatCustomCommandPrompt({
        argumentCount: expanded.argumentCount,
        body,
        command,
        usedArgumentsPlaceholder: expanded.usedArgumentsPlaceholder,
      }).prompt;
    }
    return expandCustomCommandPrompt({
      args: invocation.args,
      command,
    }).prompt;
  } catch (error) {
    if (error instanceof Error && CUSTOM_COMMAND_NOT_FOUND_PATTERN.test(error.message)) {
      return undefined;
    }
    throw error;
  }
}

function parsePromptCustomCommandInvocation(input: string): { args: string; name: string } | null {
  const match = PROMPT_CUSTOM_COMMAND_PATTERN.exec(input.trim());
  if (!match?.[1]) {
    return null;
  }
  return {
    args: match[2]?.trim() ?? "",
    name: match[1].toLowerCase(),
  };
}
