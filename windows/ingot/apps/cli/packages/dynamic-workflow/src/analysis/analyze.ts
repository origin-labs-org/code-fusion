import { collectDiagnostics, createWorkflowProgram } from "../compiler/compile.js";
import type { CompileDiagnostic } from "../compiler/compile.js";
import { collectSites } from "./sites.js";
import { collectFacadeMisuse } from "./facade-misuse.js";
import { collectWorldRunCommands } from "./world-run.js";
import { collectArtifactDeclarations, type DeclaredArtifact } from "./artifacts.js";
import { collectPhaseMarkerDiagnostics } from "./phases.js";
import { collectHoleDiagnostics } from "./hole-sites.js";
import { collectDuplicateActorNames, FANOUT_ACTOR_NAME_CODE } from "./actor-names.js";
import { collectActorModels, type ModelReference } from "./actor-models.js";
import { interpret } from "./interpret.js";
import { projectSiteGraph } from "./graph.js";
import { projectCausalityGraph, type CausalityGraph } from "./causality-graph.js";
import { projectControlFlow, type ControlFlowGraph } from "./flow-graph.js";
import { projectHandoffGraph, type HandoffGraph } from "./handoff-graph.js";
import type { AnalysisCore } from "./core.js";
import type { SiteGraph } from "./types.js";

/**
 * Result of analyzing a workflow script: the same diagnostics `compileWorkflowScript`
 * produces, plus the analysis core and its two projected views.
 *
 * `ok` means "submittable": any diagnostic clears it. The core and the graphs are present
 * whenever the script was analyzable at all, which is *almost* the same thing — the one
 * diagnostic that leaves them in place is {@link FANOUT_ACTOR_NAME_CODE} (a static actor
 * name inside a fan-out). That clause describes a **run-time** failure, not something that
 * stops the analysis: the shape is perfectly analyzable, and withholding the graph would
 * hide the picture exactly when the author needs it to see which fan-out to fix. So:
 * graphs present ⟸ ok, but not the converse.
 */
export interface AnalyzeResult {
  diagnostics: CompileDiagnostic[];
  ok: boolean;
  /**
   * The all-in-one analysis artifact: taint
   * facts + temporal trace, position-free. `graph` and `causality` are pure projections
   * of it — deriving them again later needs the core only, never the script.
   */
  core?: AnalysisCore;
  graph?: SiteGraph;
  /** The presentation-level happens-before view. */
  causality?: CausalityGraph;
  /** Where execution can go next, per occurrence and per phase. */
  flow?: ControlFlowGraph;
  /** Who takes part in each phase and who hands off to whom. */
  handoff?: HandoffGraph;
  
  declaredArtifacts: DeclaredArtifact[];
  
  modelReferences: ModelReference[];
}

/**
 * Typecheck a workflow script and, when clean, interpret it. The pipeline is
 * createWorkflowProgram -> collectSites (the site-table substrate) -> interpret (the
 * fused taint-fixpoint + temporal walk, minting the {@link AnalysisCore}) ->
 * projectSiteGraph / projectCausalityGraph (pure projections of the core).
 *
 * Between the site table and the interpretation runs the facade-siting check
 * ({@link collectFacadeMisuse}): a facade callable that escapes into value space has
 * no site, so the graph cannot represent it. Its diagnostics are surfaced exactly like
 * typechecker diagnostics — `ok: false`, graphs withheld.
 */
export function analyzeWorkflowScript(scriptText: string): AnalyzeResult {
  const workflow = createWorkflowProgram(scriptText);
  const diagnostics = collectDiagnostics(workflow.program);
  if (diagnostics.length > 0) {
    return { declaredArtifacts: [], diagnostics, modelReferences: [], ok: false };
  }

  const table = collectSites(workflow);
  const misuse = collectFacadeMisuse(workflow, table);
  if (misuse.length > 0) {
    return { declaredArtifacts: [], diagnostics: misuse, modelReferences: [], ok: false };
  }

  const worldRun = collectWorldRunCommands(workflow, table);
  const artifacts = collectArtifactDeclarations(workflow, table);
  const models = collectActorModels(workflow, table);
  const authoring = [
    ...worldRun.diagnostics,
    ...artifacts.diagnostics,
    ...models.diagnostics,
    ...collectPhaseMarkerDiagnostics(workflow, table),
    ...collectHoleDiagnostics(workflow, table),
    ...collectDuplicateActorNames(workflow, table),
  ];
  const withholding = authoring.filter((d) => d.code !== FANOUT_ACTOR_NAME_CODE);
  if (withholding.length > 0) {
    return {
      declaredArtifacts: artifacts.declaredArtifacts,
      diagnostics: authoring,
      modelReferences: models.references,
      ok: false,
    };
  }

  // One interpretation feeds everything: the core carries the taint facts AND the
  // temporal trace, and both graphs project off it without touching the AST again.
  const core = interpret(workflow, table);
  const graph = projectSiteGraph(core);
  const causality = projectCausalityGraph(core, graph);
  return {
    causality,
    core,
    declaredArtifacts: artifacts.declaredArtifacts,
    diagnostics: authoring,
    flow: projectControlFlow(core),
    graph,
    handoff: projectHandoffGraph(core, causality, graph),
    modelReferences: models.references,
    ok: authoring.length === 0,
  };
}
