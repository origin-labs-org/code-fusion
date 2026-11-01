

import ts from "typescript";
import type { CompileDiagnostic, ScriptLoc, WorkflowProgram } from "../compiler/compile.js";
import { facadeMemberOf, valueFunctionOfSymbol } from "../facade/registry.js";
import { findWorkflowBody, resolveSymbol, type SiteTable } from "./sites.js";

export const MODEL_REFERENCE_CODE = 9010;

export const MODEL_UNRESOLVED_CODE = 9011;

export interface ModelReference {
  
  name: string;
  line: number;
  column: number;
}

export interface ActorModels {
  
  references: ModelReference[];
  
  diagnostics: CompileDiagnostic[];
}

const WIDENED_MODEL_MESSAGE =
  "A subagent's `model` must be known before the run starts: a string literal, a union of " +
  'string literals, or a ModelRef from model("…"). This value\'s type is {type}, which could ' +
  "be any model name. Write the name inline, add `as const` where it is declared, or declare " +
  "the candidates with model() and choose among those ModelRefs at run time.";

const MODEL_CALL_MESSAGE =
  "model() takes the model name as a non-empty string literal (a model id or " +
  '"providerId/modelId", optionally with "$level"): every model a script can use is checked ' +
  "against the configured models before the run starts. Put runtime choices in which ModelRef " +
  "you pass, not in the name.";

const MODEL_REF_VALUE_MESSAGE =
  "ModelRef exists only as a type: at run time a ModelRef is its model name. Use it in type " +
  "positions only; compare ModelRefs directly or keep a table keyed by your own choice.";

export function collectActorModels(workflow: WorkflowProgram, table: SiteTable): ActorModels {
  const { program, scriptFile, toScriptLoc } = workflow;
  const checker = program.getTypeChecker();
  const references: ModelReference[] = [];
  const diagnostics: CompileDiagnostic[] = [];
  const locOf = (node: ts.Node): ScriptLoc => toScriptLoc(node.getStart(scriptFile));
  const report = (at: ts.Node, message: string): void => {
    const loc = locOf(at);
    diagnostics.push({ code: MODEL_REFERENCE_CODE, column: loc.column, line: loc.line, message });
  };
  const collect = (name: string, at: ts.Node): void => {
    const loc = locOf(at);
    references.push({ column: loc.column, line: loc.line, name });
  };

  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (valueFunctionOfSymbol(resolveSymbol(node.expression, checker)) === "model") {
        const arg = node.arguments[0];
        if (arg !== undefined && ts.isStringLiteralLike(arg) && arg.text.trim().length > 0) {
          collect(arg.text, arg);
        } else {
          report(arg ?? node, MODEL_CALL_MESSAGE);
        }
      }
    } else if (ts.isIdentifier(node) && isModelRefClass(resolveSymbol(node, checker))) {
      if (!isTypePosition(node)) report(node, MODEL_REF_VALUE_MESSAGE);
    }
    ts.forEachChild(node, walk);
  };
  walk(findWorkflowBody(scriptFile));

  const checkModelValue = (expr: ts.Expression, type: ts.Type): void => {
    const members = type.isUnion() ? type.types : [type];
    for (const member of members) {
      if ((member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0) continue;
      if (isModelRefType(member)) continue;
      if (member.isStringLiteral()) {
        if (member.value.trim().length > 0) {
          collect(member.value, expr);
          continue;
        }
      }
      report(expr, WIDENED_MODEL_MESSAGE.replace("{type}", `'${checker.typeToString(type)}'`));
      return;
    }
  };

  const checkPersona = (persona: ts.Expression): void => {
    if (ts.isParenthesizedExpression(persona)) {
      checkPersona(persona.expression);
      return;
    }
    if (ts.isConditionalExpression(persona)) {
      checkPersona(persona.whenTrue);
      checkPersona(persona.whenFalse);
      return;
    }
    if (ts.isObjectLiteralExpression(persona)) {
      const modelExpr = lastModelInitializer(persona);
      if (modelExpr === "spread") {
        checkPersonaType(persona);
      } else if (modelExpr !== undefined) {
        checkModelValue(modelExpr, modelValueType(modelExpr, checker));
      }
      return;
    }
    checkPersonaType(persona);
  };

  const checkPersonaType = (persona: ts.Expression): void => {
    const type = checker.getTypeAtLocation(persona);
    const members = type.isUnion() ? type.types : [type];
    for (const member of members) {
      if ((member.flags & ts.TypeFlags.StringLike) !== 0) continue;
      const property = checker.getPropertyOfType(member, "model");
      if (property === undefined) continue;
      checkModelValue(persona, checker.getTypeOfSymbolAtLocation(property, persona));
    }
  };

  for (const site of table.actors) {
    const persona = site.call.arguments[1];
    if (persona !== undefined) checkPersona(persona);
  }

  return { diagnostics, references };
}

function lastModelInitializer(
  literal: ts.ObjectLiteralExpression,
): ts.Expression | "spread" | undefined {
  let found: ts.Expression | "spread" | undefined;
  for (const property of literal.properties) {
    if (ts.isSpreadAssignment(property)) {
      found = "spread";
    } else if (ts.isPropertyAssignment(property) && propertyNameText(property.name) === "model") {
      found = property.initializer;
    } else if (ts.isShorthandPropertyAssignment(property) && property.name.text === "model") {
      found = property.name;
    }
  }
  return found;
}

function modelValueType(expr: ts.Expression, checker: ts.TypeChecker): ts.Type {
  const parent = expr.parent;
  if (ts.isShorthandPropertyAssignment(parent) && parent.name === expr) {
    const value = checker.getShorthandAssignmentValueSymbol(parent);
    if (value !== undefined) return checker.getTypeOfSymbolAtLocation(value, expr);
  }
  return checker.getTypeAtLocation(expr);
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function isModelRefClass(symbol: ts.Symbol | undefined): boolean {
  const member = facadeMemberOf(symbol);
  return (
    member !== undefined &&
    member.container === undefined &&
    member.member === "ModelRef" &&
    symbol !== undefined &&
    (symbol.flags & ts.SymbolFlags.Class) !== 0
  );
}

function isModelRefType(type: ts.Type): boolean {
  return isModelRefClass(type.getSymbol());
}

function isTypePosition(node: ts.Identifier): boolean {
  let parent: ts.Node = node.parent;
  while (ts.isQualifiedName(parent)) parent = parent.parent;
  return ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent);
}
