

import ts from "typescript";
import type { CompileDiagnostic, WorkflowProgram } from "../compiler/compile.js";
import type { SiteTable } from "./sites.js";

export const WORLD_RUN_LITERAL_CODE = 9003;

export interface WorldRunCommands {
  
  commands: string[];
  
  diagnostics: CompileDiagnostic[];
}

export function collectWorldRunCommands(
  workflow: WorkflowProgram,
  table: SiteTable,
): WorldRunCommands {
  const commands = new Set<string>();
  const diagnostics: CompileDiagnostic[] = [];
  for (const site of table.worldReads) {
    if (site.op !== "run") continue;
    const cmd = site.args[0];
    if (cmd !== undefined && ts.isStringLiteralLike(cmd)) {
      commands.add(cmd.text);
      continue;
    }
    const loc = cmd === undefined ? site.loc : workflow.toScriptLoc(cmd.getStart());
    diagnostics.push({
      code: WORLD_RUN_LITERAL_CODE,
      column: loc.column,
      line: loc.line,
      message:
        "world.run's first argument must be a compile-time string literal (\"lean\" or a " +
        "no-substitution template): the script's command set is shown to the user at " +
        "confirmation and only those commands are executable. Move the command name out of " +
        "the variable/template, and put runtime values in the args array instead.",
    });
  }
  return { commands: [...commands].sort(), diagnostics };
}
