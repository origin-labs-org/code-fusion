// ============================================================
// ============================================================
// docs/dynamic-workflow/authoring.md「Choosing a model per subagent」。
//
//
//

import {
  MODEL_UNRESOLVED_CODE,
  type AnalyzeResult,
  type ModelReference,
} from "@origin-ai/cf-dynamic-workflow";
import type { CreateWorkflowDiagnostic, ModelCatalogPort, ModelSelection } from "@origin-ai/cf-contracts";
import { parseModelPickerValue } from "@origin-ai/cf-shared/model-selection";
import type { ToolInputResolutionResult } from "../types.js";
import { analyzeScript } from "./workflow-script-analysis.js";
import { resolveModelReference } from "./model-reference.js";

export type ScriptModelBindings = Record<string, string>;

export const SCRIPT_MODELS_UNAVAILABLE =
  "This host cannot choose models; remove `model` from the personas (the subagents then run on the run's subagent model).";

type NameResolution = { ok: true; canonical: string } | { ok: false; message: string };

function resolveName(
  name: string,
  catalog: ModelCatalogPort | undefined,
  inherited: ScriptModelBindings | undefined,
): NameResolution {
  if (catalog === undefined) return { ok: false, message: SCRIPT_MODELS_UNAVAILABLE };
  const entries = catalog.listModels();
  const previous = inherited?.[name];
  if (previous !== undefined) {
    const resolution = resolveModelReference(previous, entries);
    if (resolution.ok) return { ok: true, canonical: resolution.canonical };
    return {
      ok: false,
      message: `"${name}" keeps the model the amended run bound it to, ${previous}, which cannot be used now. ${resolution.message}`,
    };
  }
  const resolution = resolveModelReference(name, entries);
  if (resolution.ok) return { ok: true, canonical: resolution.canonical };
  return {
    ok: false,
    message: `The model "${name}" named in the script cannot be used: ${resolution.message}`,
  };
}

export function distinctModelNames(references: readonly ModelReference[]): string[] {
  return [...new Set(references.map((reference) => reference.name))];
}

export function resolveScriptModelBindings(
  names: readonly string[],
  catalog: ModelCatalogPort | undefined,
  inherited?: ScriptModelBindings,
): ScriptModelBindings {
  const bindings: ScriptModelBindings = {};
  for (const name of names) {
    const resolution = resolveName(name, catalog, inherited);
    if (resolution.ok) bindings[name] = resolution.canonical;
  }
  return bindings;
}

export function withScriptModelBindings(
  input: Record<string, unknown>,
  catalog: ModelCatalogPort | undefined,
  inherited?: ScriptModelBindings,
): Record<string, unknown> {
  const { model_bindings: _forged, ...rest } = input;
  void _forged;
  const script = rest.script;
  if (typeof script !== "string") return rest;
  const analysis = analyzeScript(script);
  if (!analysis.ok) return rest;
  const names = distinctModelNames(analysis.modelReferences);
  if (names.length === 0) return rest;
  const bindings = resolveScriptModelBindings(names, catalog, inherited);
  return Object.keys(bindings).length === 0 ? rest : { ...rest, model_bindings: bindings };
}

export function withScriptModelBindingsResolved(
  resolution: ToolInputResolutionResult,
  catalog: ModelCatalogPort | undefined,
  inherited?: ScriptModelBindings,
): ToolInputResolutionResult {
  if (!resolution.result) return resolution;
  const input = resolution.input;
  if (typeof input !== "object" || input === null || Array.isArray(input)) return resolution;
  return {
    result: true,
    input: withScriptModelBindings(input as Record<string, unknown>, catalog, inherited),
  };
}

export function readScriptModelBindings(input: unknown): ScriptModelBindings {
  if (typeof input !== "object" || input === null) return {};
  const raw = (input as { model_bindings?: unknown }).model_bindings;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const bindings: ScriptModelBindings = {};
  for (const [name, canonical] of Object.entries(raw)) {
    if (typeof canonical === "string") bindings[name] = canonical;
  }
  return bindings;
}

export function allScriptModelsBound(
  analysis: AnalyzeResult,
  bindings: ScriptModelBindings,
): boolean {
  return analysis.modelReferences.every((reference) => bindings[reference.name] !== undefined);
}

export function unresolvedScriptModelDiagnostics(
  analysis: AnalyzeResult,
  bindings: ScriptModelBindings,
  catalog: ModelCatalogPort | undefined,
  inherited?: ScriptModelBindings,
): CreateWorkflowDiagnostic[] {
  const diagnostics: CreateWorkflowDiagnostic[] = [];
  const reported = new Set<string>();
  for (const reference of analysis.modelReferences) {
    if (bindings[reference.name] !== undefined || reported.has(reference.name)) continue;
    reported.add(reference.name);
    const resolution = resolveName(reference.name, catalog, inherited);
    diagnostics.push({
      code: MODEL_UNRESOLVED_CODE,
      line: reference.line,
      column: reference.column,
      message: resolution.ok
        ? `The model "${reference.name}" became available only after this call was checked; submit the script again.`
        : resolution.message,
    });
  }
  return diagnostics;
}

export function scriptModelSelections(
  bindings: ScriptModelBindings,
): Record<string, ModelSelection> | undefined {
  const names = Object.keys(bindings);
  if (names.length === 0) return undefined;
  const selections: Record<string, ModelSelection> = {};
  for (const name of names) {
    try {
      selections[name] = parseModelPickerValue(bindings[name]!);
    } catch (cause) {
      throw new Error(`workflow model_bindings reached the handler un-canonicalised: ${name}`, {
        cause,
      });
    }
  }
  return selections;
}

export function describeScriptModelBindings(bindings: ScriptModelBindings): string {
  const entries = Object.entries(bindings);
  if (entries.length === 0) return "";
  const pairs = entries.map(([name, canonical]) => `"${name}" = ${canonical}`);
  return ` Models named in the script: ${pairs.join("; ")}.`;
}

export function bindScriptModels(
  analysis: AnalyzeResult,
  catalog: ModelCatalogPort | undefined,
  inherited?: ScriptModelBindings,
): {
  selections: Record<string, ModelSelection> | undefined;
  unbound: CreateWorkflowDiagnostic[];
} {
  const bindings = resolveScriptModelBindings(
    distinctModelNames(analysis.modelReferences),
    catalog,
    inherited,
  );
  const unbound = unresolvedScriptModelDiagnostics(analysis, bindings, catalog, inherited);
  return { selections: unbound.length > 0 ? undefined : scriptModelSelections(bindings), unbound };
}
