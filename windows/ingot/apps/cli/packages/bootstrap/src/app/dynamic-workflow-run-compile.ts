// ============================================================
// ============================================================

import { createHash } from "node:crypto";
import {
  buildAskSpecs,
  collectSites,
  collectWorldRunCommands,
  createWorkflowProgram,
  collectPhaseNames,
  collectSitePhases,
  deriveActorSubmitProfiles,
  interpret,
  lowerWorkflow,
  projectControlFlow,
  synthesizeAskSchemas,
  type CompileDiagnostic,
  type SiteTable,
  type WorkflowProgram,
} from "@origin-ai/cf-dynamic-workflow";
import { projectSiteGraph } from "@origin-ai/cf-dynamic-workflow/projections";
import { compiledHolesOf } from "./dynamic-workflow-run-holes.js";
import type { CompiledDynamicWorkflowScript } from "./dynamic-workflow-run-launch.js";

export function compileOnce(scriptText: string): CompiledDynamicWorkflowScript {
  return compileProgram(scriptText, createWorkflowProgram(scriptText));
}

const RESUME_DIAGNOSTICS_MAX_CHARS = 2000;

export function boundedResumeDiagnostics(runId: string, diagnostics: CompileDiagnostic[]): string {
  const body = [
    `The stored script of run ${runId} no longer compiles against the current workflow facade:`,
    ...diagnostics.map(
      (diagnostic) => `L${diagnostic.line}:C${diagnostic.column} ${diagnostic.message}`,
    ),
  ].join("\n");
  return body.length > RESUME_DIAGNOSTICS_MAX_CHARS
    ? `${body.slice(0, RESUME_DIAGNOSTICS_MAX_CHARS - 1)}…`
    : body;
}

export function compileProgram(
  scriptText: string,
  workflow: WorkflowProgram,
  
  collected?: SiteTable,
): CompiledDynamicWorkflowScript {
  const diagnostics = [
    ...workflow.program.getSyntacticDiagnostics(),
    ...workflow.program.getSemanticDiagnostics(),
  ];
  if (diagnostics.length > 0) {
    throw new Error(
      `dynamic workflow submit received a script that does not typecheck (${diagnostics.length} diagnostics); no run was created`,
    );
  }

  const table = collected ?? collectSites(workflow);
  const { diagnostics: schemaDiagnostics, schemas } = synthesizeAskSchemas(workflow, table);
  if (schemaDiagnostics.length > 0) {
    throw new Error(
      `dynamic workflow submit received a script with unsupported ask result types: ${schemaDiagnostics
        .map((diagnostic) => `L${diagnostic.line}:C${diagnostic.column} ${diagnostic.message}`)
        .join("; ")}`,
    );
  }
  const worldRun = collectWorldRunCommands(workflow, table);
  if (worldRun.diagnostics.length > 0) {
    throw new Error(
      `dynamic workflow submit received a script with non-literal world.run commands (${worldRun.diagnostics.length} diagnostics); no run was created`,
    );
  }

  const askSpecs = buildAskSpecs(table, schemas);

  const core = interpret(workflow, table);
  const lowered = lowerWorkflow(workflow, table);

  return {
    askSpecs,
    actorSubmitProfiles: deriveActorSubmitProfiles(projectSiteGraph(core), askSpecs),
    sitePhases: collectSitePhases(core),
    lowered: lowered.code,
    holeBodies: lowered.holeBodies,
    holes: compiledHolesOf(table),
    phases: collectPhaseNames(projectControlFlow(core)),
    scriptHash: createHash("sha256").update(scriptText, "utf8").digest("hex"),
  };
}
