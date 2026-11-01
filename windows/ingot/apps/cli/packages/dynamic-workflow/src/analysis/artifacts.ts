

import ts from "typescript";
import type { CompileDiagnostic, ScriptLoc, WorkflowProgram } from "../compiler/compile.js";
import { ARTIFACT_CAPS, ARTIFACT_ID_PATTERN } from "../facade/artifact-caps.js";
import { isArtifactPresetOp, type ArtifactOp } from "../facade/registry.js";
import { findWorkflowBody, type ArtifactSite, type SiteTable } from "./sites.js";

export const ARTIFACT_DECLARATION_CODE = 9007;

export const ARTIFACT_HOISTING_CODE = 9008;

export const ARTIFACT_PRIMARY_CONFLICT_CODE = 9009;

export interface DeclaredArtifact {
  id: string;
  
  kind: ArtifactOp;
}

export interface ArtifactDeclarations {
  
  declaredArtifacts: DeclaredArtifact[];
  
  diagnostics: CompileDiagnostic[];
}

type HoistingContext = "loop" | "callback" | "conditional";

const HOISTING_MESSAGE: Record<HoistingContext, string> = {
  callback:
    "a preset artifact declared inside a callback: hoist it to the top level and declare it once. " +
    "A preset is a declaration, not a step — it says how the items tagged with its id are drawn, " +
    "and the tagged report() calls are what fill it in. Declaring it where the callback runs " +
    'buries it: move artifact.<kind>("<id>", spec) to the head of the script and keep only ' +
    'report(item, "<id>") in the callback.',
  conditional:
    "a preset artifact declared inside a conditional branch: hoist it to the top level and declare " +
    "it once. The card should exist from the moment the run starts (it is legitimately empty until " +
    "the first tagged report arrives), and a declaration that may or may not have run is a card " +
    "that may or may not exist. Declare it unconditionally and let the branch decide what to report.",
  loop:
    "a preset artifact declared inside a loop: hoist it to the top level and declare it once. " +
    "A preset is declared once and fed many times — the loop body is where report(item, \"<id>\") " +
    "belongs, not the declaration. Re-declaring the same spec is a no-op, but re-declaring it with " +
    "a different spec fails the whole run, so the loop is the wrong place for it either way.",
};

const NON_LITERAL_ID_MESSAGE =
  "an artifact id must be a compile-time string literal (\"report\" or a no-substitution template): " +
  "the set of artifacts a run can publish is fixed when the script is submitted, so it can be listed " +
  "before anything runs. Write the id inline; put the runtime value in the title instead " +
  '(artifact.file("report", path, { title: `Report for ${name}` })).';

const EMPTY_ID_MESSAGE =
  "an artifact id must not be empty: it is the identity the card, the version history and the " +
  'report tag all key off. Give it a short stable name ("book", "perf", "coverage").';

export function collectArtifactDeclarations(
  workflow: WorkflowProgram,
  table: SiteTable,
): ArtifactDeclarations {
  const diagnostics: CompileDiagnostic[] = [];
  const push = (code: number, loc: ScriptLoc, message: string): void => {
    diagnostics.push({ code, column: loc.column, line: loc.line, message });
  };
  const locOf = (node: ts.Node): ScriptLoc =>
    workflow.toScriptLoc(node.getStart(workflow.scriptFile));

  const body = findWorkflowBody(workflow.scriptFile);
  
  const holeBodies = new Set<ts.Node>(table.holes.flatMap((hole) => hole.body ?? []));
  
  const claimed = new Map<string, ArtifactSite>();
  
  let primaryClaim: { id: string; site: ArtifactSite } | undefined;
  const declared: DeclaredArtifact[] = [];

  for (const site of table.artifacts) {
    const idLoc = site.artifactIdExpr === undefined ? site.loc : locOf(site.artifactIdExpr);
    if (site.artifactId === undefined) {
      push(ARTIFACT_DECLARATION_CODE, idLoc, NON_LITERAL_ID_MESSAGE);
      continue;
    }
    const id = site.artifactId;
    if (id === "") {
      push(ARTIFACT_DECLARATION_CODE, idLoc, EMPTY_ID_MESSAGE);
      continue;
    }
    if (id.length > ARTIFACT_CAPS.maxIdLength) {
      push(
        ARTIFACT_DECLARATION_CODE,
        idLoc,
        `artifact id "${id}" is ${id.length} characters; the limit is ${ARTIFACT_CAPS.maxIdLength}. ` +
          "The id is a key, not a description — put the prose in the title.",
      );
      continue;
    }
    if (!ARTIFACT_ID_PATTERN.test(id)) {
      push(
        ARTIFACT_DECLARATION_CODE,
        idLoc,
        `artifact id "${id}" contains characters outside [A-Za-z0-9_.-]. The id is carried verbatim ` +
          "through the journal, the artifact store and the side pane, so it is restricted to " +
          'characters that need no escaping anywhere ("build-log", "perf.p95").',
      );
      continue;
    }

    const first = claimed.get(id);
    if (first === undefined) {
      claimed.set(id, site);
      declared.push({ id, kind: site.op });
    } else if (first.op !== site.op) {
      push(
        ARTIFACT_DECLARATION_CODE,
        site.loc,
        `artifact id "${id}" is used with two different kinds: artifact.${first.op} on line ` +
          `${first.loc.line} and artifact.${site.op} here. Within one run an id belongs to exactly ` +
          "one kind — publishing it again is what mints the next VERSION, and a version cannot " +
          "change what the thing is. Give this one its own id.",
      );
    }

    const primaryNode = primaryLiteralOf(site);
    if (primaryNode !== undefined) {
      if (primaryClaim === undefined) primaryClaim = { id, site };
      else if (primaryClaim.id !== id) {
        push(
          ARTIFACT_PRIMARY_CONFLICT_CODE,
          locOf(primaryNode),
          `artifact "${id}" is marked primary, but "${primaryClaim.id}" already is (artifact.` +
            `${primaryClaim.site.op} on line ${primaryClaim.site.loc.line}). A run has one ` +
            "deliverable — the card and the run pane lead with it. Drop primary from one of them, " +
            "or publish this content as a new version of the other id.",
        );
      }
    }

    if (isArtifactPresetOp(site.op)) {
      const context = hoistingContextOf(site.call, body, holeBodies);
      if (context !== undefined) {
        push(ARTIFACT_HOISTING_CODE, site.loc, HOISTING_MESSAGE[context]);
      }
    }
  }

  const presetIds = declared.filter((entry) => isArtifactPresetOp(entry.kind)).map((e) => e.id);
  const contentIds = new Set(
    declared.filter((entry) => !isArtifactPresetOp(entry.kind)).map((e) => e.id),
  );

  for (const site of table.reports) {
    if (site.artifactIdExpr === undefined) continue;
    const tagLoc = locOf(site.artifactIdExpr);
    if (site.artifactId === undefined) {
      push(
        ARTIFACT_DECLARATION_CODE,
        tagLoc,
        "report()'s artifact tag must be a compile-time string literal naming a preset artifact " +
          "declared in this script: the tag is how an item finds its dashboard, and a tag that only " +
          "exists at run time cannot be checked against the declarations. Write the id inline.",
      );
      continue;
    }
    const tag = site.artifactId;
    if (presetIds.includes(tag)) continue;
    if (contentIds.has(tag)) {
      push(
        ARTIFACT_DECLARATION_CODE,
        tagLoc,
        `report()'s tag "${tag}" names a file/markdown artifact, which holds content rather than a ` +
          "stream of items — there is nothing for this item to become. Tag the item with a preset " +
          "artifact (chart / table / metrics / board), or drop the tag and let the item go to the " +
          "run's Results.",
      );
      continue;
    }
    push(
      ARTIFACT_DECLARATION_CODE,
      tagLoc,
      `report()'s tag "${tag}" names no preset artifact declared in this script${describePresets(presetIds)}. ` +
        'Declare it first — artifact.chart("' +
        tag +
        '", { x, y }) at the top of the script — or drop the tag.',
    );
  }

  return { declaredArtifacts: sortDeclared(declared), diagnostics };
}

function primaryLiteralOf(site: ArtifactSite): ts.Node | undefined {
  const arg = site.call.arguments[isArtifactPresetOp(site.op) ? 1 : 2];
  if (arg === undefined || !ts.isObjectLiteralExpression(arg)) return undefined;
  for (const property of arg.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = property.name;
    const key = ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
    if (key !== "primary") continue;
    return property.initializer.kind === ts.SyntaxKind.TrueKeyword ? property : undefined;
  }
  return undefined;
}

function describePresets(presetIds: readonly string[]): string {
  if (presetIds.length === 0) return " (this script declares no preset artifacts at all)";
  return ` (declared presets: ${[...presetIds].sort().map((id) => `"${id}"`).join(", ")})`;
}

function sortDeclared(declared: readonly DeclaredArtifact[]): DeclaredArtifact[] {
  const seen = new Set<string>();
  const unique: DeclaredArtifact[] = [];
  for (const entry of declared) {
    const key = `${entry.id} ${entry.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }
  return unique.sort((a, b) => (a.id === b.id ? a.kind.localeCompare(b.kind) : a.id < b.id ? -1 : 1));
}

function hoistingContextOf(
  call: ts.CallExpression,
  body: ts.Block,
  holeBodies: ReadonlySet<ts.Node>,
): HoistingContext | undefined {
  let child: ts.Node = call;
  for (let node: ts.Node | undefined = call.parent; node !== undefined; node = node.parent) {
    if (node === body) return undefined;
    if (holeBodies.has(node)) {
      child = node;
      continue;
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) {
      return "callback";
    }
    if (
      ts.isForStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node)
    ) {
      return "loop";
    }
    if (ts.isIfStatement(node) && (node.thenStatement === child || node.elseStatement === child)) {
      return "conditional";
    }
    if (ts.isConditionalExpression(node) && (node.whenTrue === child || node.whenFalse === child)) {
      return "conditional";
    }
    if (ts.isCaseClause(node) || ts.isDefaultClause(node)) return "conditional";
    child = node;
  }
  return undefined;
}
