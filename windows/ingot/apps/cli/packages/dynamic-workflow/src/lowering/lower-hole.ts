import ts from "typescript";
import type { HoleSite } from "../analysis/sites.js";

const EVALUATOR_PARAM = "__src";

export const TRANSPILE_OPTIONS: ts.CompilerOptions = {
  isolatedModules: false,
  module: ts.ModuleKind.ESNext,
  newLine: ts.NewLineKind.LineFeed,
  removeComments: false,
  target: ts.ScriptTarget.ES2022,
};

export function lowerHoleCall(
  call: ts.CallExpression,
  site: HoleSite,
  factory: ts.NodeFactory,
  hostMember: (name: string) => ts.Expression,
  siteArg: (id: string) => ts.Expression,
  visitExpr: (expr: ts.Expression) => ts.Expression,
  bodies: Map<string, ts.Expression>,
): ts.Expression {
  const [first] = call.arguments;
  const name = first === undefined ? factory.createVoidZero() : visitExpr(first);
  const prompt = site.prompt === undefined ? factory.createVoidZero() : visitExpr(site.prompt);
  const evaluator = factory.createArrowFunction(
    undefined,
    undefined,
    [factory.createParameterDeclaration(undefined, undefined, EVALUATOR_PARAM)],
    undefined,
    factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    factory.createCallExpression(factory.createIdentifier("eval"), undefined, [
      factory.createIdentifier(EVALUATOR_PARAM),
    ]),
  );
  const args: ts.Expression[] = [siteArg(site.id), name, prompt, evaluator];
  if (site.body !== undefined) {
    const body = visitExpr(site.body);
    bodies.set(site.id, body);
    args.push(body);
  }
  return factory.createCallExpression(hostMember("hole"), undefined, args);
}

export function printHoleBodies(
  bodies: ReadonlyMap<string, ts.Expression>,
  printer: ts.Printer,
  sourceFile: ts.SourceFile,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [siteId, body] of bodies) {
    const printed = printer.printNode(ts.EmitHint.Expression, body, sourceFile);
    const erased = ts.transpileModule(`(${printed})`, {
      compilerOptions: TRANSPILE_OPTIONS,
      reportDiagnostics: false,
    }).outputText;
    out[siteId] = erased.replace(/;\n?$/, "");
  }
  return out;
}
