

import ts from "typescript";
import type { CompileDiagnostic, WorkflowProgram } from "../compiler/compile.js";
import type { SiteTable } from "./sites.js";

export const DUPLICATE_ACTOR_NAME_CODE = 9005;

export const FANOUT_ACTOR_NAME_CODE = 9006;

export function collectDuplicateActorNames(
  workflow: WorkflowProgram,
  table: SiteTable,
): CompileDiagnostic[] {
  const diagnostics: CompileDiagnostic[] = [];
  const claimed = new Map<string, ts.CallExpression>();
  const fanOutBodies = new Set<ts.Node>(table.iterations.map((iteration) => iteration.body));
  for (const site of table.actors) {
    const name = staticEffectiveName(site.call);
    if (name === undefined || name === "") continue;
    const first = claimed.get(name);
    if (first === undefined) claimed.set(name, site.call);
    const loc = workflow.toScriptLoc(site.call.getStart(workflow.scriptFile));
    if (isInsideFanOut(site.call, fanOutBodies)) {
      diagnostics.push({
        code: FANOUT_ACTOR_NAME_CODE,
        column: loc.column,
        line: loc.line,
        message:
          `this agent(...) runs once per element of a fan-out but its name "${name}" is a fixed ` +
          `string, so every element creates a different actor under the same name — the run ` +
          `fails with DuplicateActorName as soon as the collection holds more than one item. ` +
          `An actor name must be unique within a run: it is the identity key an amended re-run ` +
          `matches its imported cache against. Build a per-element name (\`${name}-\${item}\`), ` +
          `or drop the name — anonymous actors are legal (they just never reuse cached work).`,
      });
      continue;
    }
    if (first === undefined) continue;
    const firstLoc = workflow.toScriptLoc(first.getStart(workflow.scriptFile));
    diagnostics.push({
      code: DUPLICATE_ACTOR_NAME_CODE,
      column: loc.column,
      line: loc.line,
      message:
        `two actors are named "${name}" (the first is on line ${firstLoc.line}): an actor name ` +
        `must be unique within a run. The name is the identity key an amended re-run matches ` +
        `its imported cache against, and any run can become the predecessor of one, so a ` +
        `repeated name makes that match ambiguous. Give this one its own name, or drop the ` +
        `name entirely — anonymous actors are legal (they just never reuse cached work).`,
    });
  }
  return diagnostics;
}

function isInsideFanOut(call: ts.CallExpression, fanOutBodies: ReadonlySet<ts.Node>): boolean {
  for (let node: ts.Node | undefined = call; node !== undefined; node = node.parent) {
    if (fanOutBodies.has(node)) return true;
  }
  return false;
}

function staticEffectiveName(call: ts.CallExpression): string | undefined {
  const [nameArg, personaArg] = call.arguments;
  if (personaArg !== undefined && !ts.isStringLiteralLike(personaArg)) {
    if (!ts.isObjectLiteralExpression(personaArg)) return undefined;
    for (const property of personaArg.properties) {
      if (ts.isSpreadAssignment(property)) return undefined;
      if (property.name !== undefined && ts.isComputedPropertyName(property.name)) return undefined;
      if (property.name === undefined || !isNameKey(property.name)) continue;
      if (!ts.isPropertyAssignment(property)) return undefined;
      return ts.isStringLiteralLike(property.initializer)
        ? property.initializer.text
        : undefined;
    }
  }
  return nameArg !== undefined && ts.isStringLiteralLike(nameArg) ? nameArg.text : undefined;
}

function isNameKey(key: ts.PropertyName): boolean {
  return (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) && key.text === "name";
}
