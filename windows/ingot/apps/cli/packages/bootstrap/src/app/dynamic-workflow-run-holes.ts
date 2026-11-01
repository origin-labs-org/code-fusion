// ============================================================
// ============================================================

import type {
  DynamicWorkflowRunFillHoleDiagnostic,
  DynamicWorkflowRunHole,
} from "@origin-ai/cf-contracts";
import {
  collectSites,
  createWorkflowProgram,
  MODEL_UNRESOLVED_CODE,
  type CompileDiagnostic,
  type JournalStorePort,
  type ModelReference,
  type OpenHole,
  type RunEvent,
  type SiteTable,
  type StoredEvent,
} from "@origin-ai/cf-dynamic-workflow";
import type { RunRegistryEntry } from "./dynamic-workflow-run-observation.js";

const SNAPSHOT_MAX_HOLES = 32;

const UNKNOWN_HOLE_TYPE = "unknown";

export interface CompiledHole {
  siteId: string;
  name: string;
  type: string;
  
  line: number;
  
  open: boolean;
}

export function compiledHolesOf(table: SiteTable): CompiledHole[] {
  return table.holes.map((site) => ({
    siteId: site.id,
    name: site.name ?? site.id,
    type: site.typeText ?? UNKNOWN_HOLE_TYPE,
    line: site.loc.line,
    open: site.body === undefined,
  }));
}

export function openHoleIndexes(
  phaseNames: readonly string[] | undefined,
  holes: readonly CompiledHole[],
): number[] | undefined {
  if (phaseNames === undefined) return undefined;
  const open = new Set(holes.filter((hole) => hole.open).map((hole) => hole.name));
  const indexes: number[] = [];
  phaseNames.forEach((name, index) => {
    if (open.has(name)) indexes.push(index);
  });
  return indexes.length === 0 ? undefined : indexes;
}

const HOLE_EVENT_TYPES: RunEvent["type"][] = ["hole-reached", "hole-filled", "run-launched"];

type HoleReachedEvent = Extract<RunEvent, { type: "hole-reached" }>;
type HoleFilledEvent = Extract<RunEvent, { type: "hole-filled" }>;

export function readRunHoleEvents(journal: JournalStorePort, runId: string): StoredEvent[] {
  return journal.listEvents(runId, { types: HOLE_EVENT_TYPES, reportItems: { limit: 0 } });
}

export function phaseNamesFromEvents(events: readonly StoredEvent[]): string[] | undefined {
  let names: string[] | undefined;
  for (const { event } of events) {
    if (event.type === "run-launched" && names === undefined) names = event.phaseNames;
    if (event.type === "hole-filled") names = event.phaseNames;
  }
  return names;
}

export interface ProjectRunHolesInput {
  
  events: readonly StoredEvent[];
  
  openHoles: readonly OpenHole[] | undefined;
  
  holes: readonly CompiledHole[] | undefined;
  
  phaseNames: readonly string[] | undefined;
}

export function projectRunHoles(input: ProjectRunHolesInput): DynamicWorkflowRunHole[] {
  const waiting = new Set((input.openHoles ?? []).map((hole) => instanceKey(hole)));
  const filledBySite = new Map<string, HoleFilledEvent>();
  const reached: { event: HoleReachedEvent; at: number | undefined }[] = [];
  for (const stored of input.events) {
    if (stored.event.type === "hole-reached") {
      reached.push({ event: stored.event, at: stored.timeCreated });
    } else if (stored.event.type === "hole-filled") {
      filledBySite.set(stored.event.siteId, stored.event);
    }
  }
  const byId = new Map((input.holes ?? []).map((hole) => [hole.siteId, hole]));
  const out: DynamicWorkflowRunHole[] = [];
  for (const { event, at } of reached) {
    if (out.length >= SNAPSHOT_MAX_HOLES) break;
    const { siteId, ordinal } = event.instance;
    const compiled = byId.get(siteId);
    const filled = filledBySite.get(siteId);
    const isWaiting = waiting.has(instanceKey(event.instance));
    if (!isWaiting && filled === undefined) continue;
    out.push({
      siteId,
      ordinal,
      name: event.name,
      type: compiled?.type ?? UNKNOWN_HOLE_TYPE,
      ...(isWaiting
        ? { state: "waiting" as const, ...(at === undefined ? {} : { since: at }) }
        : {
            state: "filled" as const,
            filledAt: filled!.filledAt,
            ...(filled!.filledBy === undefined ? {} : { filledBy: filled!.filledBy }),
          }),
      ...(compiled === undefined ? {} : { line: compiled.line }),
      ...neighbourPhases(event.name, input.phaseNames),
    });
  }
  return out;
}

export function coldCompiledHoles(
  scriptText: string | undefined,
  events: readonly StoredEvent[],
): CompiledHole[] | undefined {
  if (scriptText === undefined) return undefined;
  if (!events.some((entry) => entry.event.type === "hole-reached")) return undefined;
  try {
    return compiledHolesOf(collectSites(createWorkflowProgram(scriptText)));
  } catch {
    return undefined;
  }
}

export function runHolesOf(
  runId: string,
  entry: RunRegistryEntry | undefined,
  journal: JournalStorePort,
  scriptText?: string,
): DynamicWorkflowRunHole[] {
  if (entry !== undefined && (entry.holes?.length ?? 0) === 0) return [];
  const events = readRunHoleEvents(journal, runId);
  if (events.length === 0) return [];
  const live = entry !== undefined && entry.terminal === undefined;
  return projectRunHoles({
    events,
    openHoles: live ? entry.control?.openHoles() : undefined,
    holes:
      entry?.holes ?? coldCompiledHoles(scriptText ?? journal.getRun(runId)?.scriptText, events),
    phaseNames: entry?.phaseNames ?? phaseNamesFromEvents(events),
  });
}

function instanceKey(ref: { siteId: string; ordinal: number }): string {
  return `${ref.siteId}@${ref.ordinal}`;
}

function neighbourPhases(
  name: string,
  phaseNames: readonly string[] | undefined,
): { before?: string; after?: string } {
  if (phaseNames === undefined) return {};
  const index = phaseNames.indexOf(name);
  if (index < 0) return {};
  const before = phaseNames[index - 1];
  const after = phaseNames[index + 1];
  return {
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
  };
}

export function mapFillDiagnostics(input: {
  diagnostics: readonly CompileDiagnostic[];
  effectiveText: string;
  body: string;
  insertedAtLine: number;
  insertedLines: number;
}): DynamicWorkflowRunFillHoleDiagnostic[] {
  const { diagnostics, insertedAtLine, insertedLines } = input;
  const firstBodyLine = insertedAtLine;
  const lastBodyLine = insertedAtLine + insertedLines - 2;
  const closingLine = insertedAtLine + insertedLines - 1;
  const effectiveLines = input.effectiveText.split("\n");
  const bodyLines = input.body.replace(/\r?\n$/u, "").split(/\r?\n/u);
  return diagnostics.map((diagnostic) => {
    const base = { message: diagnostic.message, code: diagnostic.code };
    if (diagnostic.line >= firstBodyLine && diagnostic.line <= lastBodyLine) {
      const bodyLine = diagnostic.line - firstBodyLine + 1;
      const indent =
        leadingWhitespace(effectiveLines[diagnostic.line - 1] ?? "") -
        leadingWhitespace(bodyLines[bodyLine - 1] ?? "");
      return {
        ...base,
        inFill: true,
        line: bodyLine,
        column: Math.max(1, diagnostic.column - Math.max(0, indent)),
      };
    }
    if (diagnostic.line === closingLine) {
      return { ...base, inFill: false, line: insertedAtLine - 1, column: diagnostic.column };
    }
    if (diagnostic.line > closingLine) {
      return {
        ...base,
        inFill: false,
        line: diagnostic.line - insertedLines,
        column: diagnostic.column,
      };
    }
    return { ...base, inFill: false, line: diagnostic.line, column: diagnostic.column };
  });
}

export function unboundFillModelDiagnostics(
  references: readonly ModelReference[],
  bindings: Readonly<Record<string, string>> | undefined,
): CompileDiagnostic[] {
  const bound = Object.entries(bindings ?? {});
  const available =
    bound.length === 0
      ? "this run was launched without naming any model"
      : `this run was launched with ${bound.map(([name, canonical]) => `"${name}" = ${canonical}`).join("; ")}`;
  const reported = new Set<string>();
  const diagnostics: CompileDiagnostic[] = [];
  for (const reference of references) {
    if (bindings?.[reference.name] !== undefined || reported.has(reference.name)) continue;
    reported.add(reference.name);
    diagnostics.push({
      code: MODEL_UNRESOLVED_CODE,
      line: reference.line,
      column: reference.column,
      message: `The model "${reference.name}" is not one the run can use: ${available}, and a fill can name only those. Use one of them, or drop \`model\` from the persona; to add a model, revise the run with AmendWorkflow.`,
    });
  }
  return diagnostics;
}

function leadingWhitespace(line: string): number {
  return /^[ \t]*/u.exec(line)?.[0].length ?? 0;
}
