

import ts from "typescript";
import type { CompileDiagnostic, ScriptLoc, WorkflowProgram } from "../compiler/compile.js";
import type { SiteTable } from "./sites.js";

export const PHASE_MARKER_CODE = 9004;

const LITERAL_MESSAGE =
  'phase()\'s argument must be a compile-time string literal ("gate" or a no-substitution ' +
  "template): the script's phase names are fixed when it is submitted, because they label " +
  "the graph the user confirms before anything runs. Write the name inline — a name that " +
  "only exists at run time cannot be drawn.";

const EMPTY_MESSAGE =
  'phase("") has no name to show: the phase label is what the confirmation graph draws. ' +
  'Give the group a word ("preflight", "gate", "wrap-up"), or drop the marker — a script ' +
  "with no markers is perfectly legal and is drawn step by step.";

const STATEMENT_MESSAGE =
  'phase("…") must stand alone as its own statement. The marker claims the rest of the block ' +
  "it stands in, so one in expression position (a variable initializer, an argument, a " +
  "ternary arm) has no rest-of-block to claim. Put the call on its own line at the head of " +
  "the steps it names.";

export function collectPhaseMarkerDiagnostics(
  workflow: WorkflowProgram,
  table: SiteTable,
): CompileDiagnostic[] {
  const diagnostics: CompileDiagnostic[] = [];
  const push = (loc: ScriptLoc, message: string): void => {
    diagnostics.push({ code: PHASE_MARKER_CODE, column: loc.column, line: loc.line, message });
  };

  for (const marker of table.phases) {
    const nameLoc =
      marker.nameExpr === undefined
        ? marker.loc
        : workflow.toScriptLoc(marker.nameExpr.getStart(workflow.scriptFile));
    if (marker.name === undefined) {
      push(nameLoc, LITERAL_MESSAGE);
    } else if (marker.name.trim() === "") {
      push(nameLoc, EMPTY_MESSAGE);
    }
    if (!ts.isExpressionStatement(marker.call.parent)) {
      push(marker.loc, STATEMENT_MESSAGE);
    }
  }
  return diagnostics;
}
