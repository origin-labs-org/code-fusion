import { BUILTIN_CF_SLASH_COMMAND_HELP_ENTRIES, type CfSlashCommand } from "@origin-ai/cf-shared";
import { BUILTIN_WORKFLOW_COMMAND_NAME } from "../builtin-workflow-command.js";
import {
  listCfCustomCommands,
  type ListCfCustomCommandsOptions,
} from "../custom-commands.js";
import {
  APP_PROTOCOL_VISIBLE_BUILTIN_SLASH_COMMAND_NAMES,
  isReservedCfSlashCommandName,
} from "../slash-command-surface.js";

export interface ListProtocolSlashCommandsOptions extends ListCfCustomCommandsOptions {
  
  dynamicWorkflowEnabled?: boolean;
}

export async function listProtocolSlashCommands(
  options: ListProtocolSlashCommandsOptions = {},
): Promise<CfSlashCommand[]> {
  const builtins = listAppProtocolBuiltinSlashCommands().filter(
    (command) =>
      options.dynamicWorkflowEnabled !== false || command.name !== BUILTIN_WORKFLOW_COMMAND_NAME,
  );
  let customCommands: Awaited<ReturnType<typeof listCfCustomCommands>>["commands"] = [];
  try {
    const outcome = await listCfCustomCommands(options);
    customCommands = outcome.commands;
  } catch {
    customCommands = [];
  }

  return [
    ...builtins,
    ...customCommands
      .filter((command) => !command.disableNonInteractive)
      .filter((command) => !isReservedCfSlashCommandName(command.name))
      .map((command) => ({
        description: command.description,
        inputHint: `/${command.name}${command.argumentHint ? ` ${command.argumentHint}` : ""}`,
        name: command.name,
        source: "custom" as const,
      })),
  ];
}

function listAppProtocolBuiltinSlashCommands(): CfSlashCommand[] {
  const sharedBuiltins = APP_PROTOCOL_VISIBLE_BUILTIN_SLASH_COMMAND_NAMES.flatMap((name) => {
    const command = BUILTIN_CF_SLASH_COMMAND_HELP_ENTRIES.find((entry) => entry.name === name);
    if (!command) return [];
    return [
      {
        description: command.summary,
        inputHint: command.usage,
        name: command.name,
        source: "builtin" as const,
      },
    ];
  });
  return sharedBuiltins;
}
