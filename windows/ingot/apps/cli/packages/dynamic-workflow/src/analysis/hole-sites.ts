

import ts from "typescript";
import type { CompileDiagnostic, ScriptLoc, WorkflowProgram } from "../compiler/compile.js";
import type { HoleSite, SiteTable } from "./sites.js";
import { literalText } from "./sites-labels.js";

export const HOLE_CODE = 9012;

export const HOLE_NAME_MAX_CHARS = 128;

const TYPE_MESSAGE =
  "hole() needs an explicit type argument (hole<Plan>(...)): the type is the contract the " +
  "fill is compiled against, and an inferred unknown is no contract. Write what the rest of " +
  "the script needs from the hole.";

const NAME_LITERAL_MESSAGE =
  "hole()'s name must be a compile-time string literal: it is the hole's phase name and the " +
  "identity every surface shows (the station, the notification, the fill file). Write it inline.";

const NAME_EMPTY_MESSAGE =
  'hole("") has no name to show. Give the gap a word in the user\'s language ("grouping", ' +
  '"choose the plan"); it labels the station and the notification.';

const NAME_LONG_MESSAGE = `hole()'s name is longer than ${HOLE_NAME_MAX_CHARS} characters; a phase name is a label, not a paragraph.`;

const AWAIT_MESSAGE =
  "hole() must be awaited where it is called (await hole<T>(...) or return await hole<T>(...)): " +
  "the script must not run past a gap that has no value yet.";

const FANOUT_MESSAGE =
  "hole() cannot stand inside a fan-out callback (xs.map(...), Promise.all(xs.map(...)) and the " +
  "other per-element array methods): the elements run concurrently, so its fill would have to " +
  "be written while they are already running. Hoist the decision out of the callback, or use a " +
  "loop (for, for...of, while), where one round waits and the fill runs in every later round.";

const BODY_INLINE_MESSAGE =
  "hole()'s body must be an inline async arrow (async () => { ... }): a fill is spliced into the " +
  "script as text, so a function held in a variable has nothing to splice.";

function duplicateMessage(name: string, other: "hole" | "marker"): string {
  return other === "hole"
    ? `two holes are named "${name}"; a hole's name is its identity and must be unique among the script's holes and phase markers.`
    : `hole "${name}" shares its name with a phase("${name}") marker; a hole is a phase of its own, so the name must be unique among holes and markers.`;
}

function idCollisionMessage(name: string, other: string): string {
  return (
    `hole "${name}" and hole "${other}" hash to the same site id; rename one of them ` +
    "(any change to the name gives it a new id)."
  );
}

function lateBindingMessage(name: string): string {
  return (
    `the hole's body reads "${name}", which is declared after the hole. The body runs at the ` +
    "hole, before that declaration executes, so the read would throw at run time. Declare it " +
    "before the hole, or compute it inside the body."
  );
}

function isFunctionLiteral(
  expr: ts.Expression | undefined,
): expr is ts.ArrowFunction | ts.FunctionExpression {
  return expr !== undefined && (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr));
}

function isTailPosition(call: ts.CallExpression): boolean {
  const parent = call.parent;
  if (ts.isReturnStatement(parent)) return true;
  return ts.isAwaitExpression(parent) && ts.isReturnStatement(parent.parent);
}

export function holeSiteOf(
  call: ts.CallExpression,
  id: string,
  order: number,
  loc: ScriptLoc,
  funcDepth: number,
  fill: string | undefined,
): HoleSite {
  const [first, second, third] = call.arguments;
  const body = isFunctionLiteral(second) ? second : isFunctionLiteral(third) ? third : undefined;
  const prompt = second !== undefined && body !== second ? second : undefined;
  const typeArg = call.typeArguments?.[0];
  const name = literalText(first);
  return {
    call,
    ...(fill === undefined ? {} : { fill }),
    id,
    loc,
    ...(name === undefined ? {} : { name }),
    nameExpr: first,
    order,
    ...(prompt === undefined ? {} : { prompt }),
    ...(body === undefined ? {} : { body }),
    tail: funcDepth === 0 && isTailPosition(call),
    ...(typeArg === undefined ? {} : { typeArg, typeText: typeArg.getText() }),
  };
}

function within(node: ts.Node, span: ts.Node, scriptFile: ts.SourceFile): boolean {
  return span.getStart(scriptFile) <= node.getStart(scriptFile) && node.getEnd() <= span.getEnd();
}

function isHoisted(declaration: ts.Declaration): boolean {
  if (ts.isFunctionDeclaration(declaration)) return true;
  if (!ts.isVariableDeclaration(declaration)) return false;
  const list = declaration.parent;
  return ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.BlockScoped) === 0;
}

export function collectHoleDiagnostics(
  workflow: WorkflowProgram,
  table: SiteTable,
): CompileDiagnostic[] {
  const { program, scriptFile, toScriptLoc } = workflow;
  const checker = program.getTypeChecker();
  const diagnostics: CompileDiagnostic[] = [];
  const push = (loc: ScriptLoc, message: string): void => {
    diagnostics.push({ code: HOLE_CODE, column: loc.column, line: loc.line, message });
  };
  const at = (node: ts.Node | undefined, fallback: ScriptLoc): ScriptLoc =>
    node === undefined ? fallback : toScriptLoc(node.getStart(scriptFile));

  const seen = new Map<string, "hole" | "marker">();
  for (const marker of table.phases) {
    const name = marker.name?.trim();
    if (name !== undefined && name !== "") seen.set(name, "marker");
  }
  const idOwner = new Map<string, string>();

  for (const site of [...table.holes].sort((a, b) => a.order - b.order)) {
    const nameLoc = at(site.nameExpr, site.loc);
    if (site.typeArg === undefined) push(site.loc, TYPE_MESSAGE);

    if (site.name === undefined) push(nameLoc, NAME_LITERAL_MESSAGE);
    else if (site.name.trim() === "") push(nameLoc, NAME_EMPTY_MESSAGE);
    else if (site.name.length > HOLE_NAME_MAX_CHARS) push(nameLoc, NAME_LONG_MESSAGE);
    else {
      const name = site.name.trim();
      const other = seen.get(name);
      if (other !== undefined) push(nameLoc, duplicateMessage(name, other));
      else {
        seen.set(name, "hole");
        const owner = idOwner.get(site.id);
        if (owner !== undefined && owner !== name) push(nameLoc, idCollisionMessage(name, owner));
        else idOwner.set(site.id, name);
      }
    }

    if (!ts.isAwaitExpression(site.call.parent)) push(site.loc, AWAIT_MESSAGE);

    const inCallback = table.iterations.some(
      (cand) => cand.form === "array-method" && within(site.call, cand.body, scriptFile),
    );
    if (inCallback) push(site.loc, FANOUT_MESSAGE);

    const [, second, third] = site.call.arguments;
    const heldBody =
      (third !== undefined && site.body !== third ? third : undefined) ??
      (second !== undefined && site.prompt === second && isCallable(second, checker)
        ? second
        : undefined);
    if (heldBody !== undefined) push(at(heldBody, site.loc), BODY_INLINE_MESSAGE);

    if (site.body !== undefined) {
      collectLateBindings(site.call, site.body, checker, scriptFile, (node, name) =>
        push(at(node, site.loc), lateBindingMessage(name)),
      );
    }
  }
  return diagnostics;
}

function isCallable(expr: ts.Expression, checker: ts.TypeChecker): boolean {
  return checker.getTypeAtLocation(expr).getCallSignatures().length > 0;
}

function collectLateBindings(
  call: ts.CallExpression,
  body: ts.ArrowFunction | ts.FunctionExpression,
  checker: ts.TypeChecker,
  scriptFile: ts.SourceFile,
  report: (node: ts.Node, name: string) => void,
): void {
  const holeStart = call.getStart(scriptFile);
  const reported = new Set<ts.Symbol>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && isValueReference(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (symbol !== undefined && !reported.has(symbol)) {
        const late = symbol.declarations?.some(
          (decl) =>
            decl.getSourceFile() === scriptFile &&
            !within(decl, body, scriptFile) &&
            decl.getStart(scriptFile) > holeStart &&
            !isHoisted(decl),
        );
        if (late === true) {
          reported.add(symbol);
          report(node, node.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body.body);
}

function isValueReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) && parent.name === node)
    return false;
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
  if (
    (ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent)) &&
    parent.name === node
  ) {
    return false;
  }
  return true;
}
