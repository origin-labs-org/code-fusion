import ts from "typescript";
import {
  collectDiagnostics,
  createWorkflowProgram,
  WORKFLOW_FUNCTION_NAME,
  type CompileDiagnostic,
  type WorkflowProgram,
} from "../compiler/compile.js";
import { FACADE_FILE_NAME } from "../facade/dts.js";
import { isArtifactPresetOp, type ArtifactOp, type WorldReadOp } from "../facade/registry.js";
import { collectFacadeMisuse } from "../analysis/facade-misuse.js";
import {
  collectSites,
  isFacadeDeclared,
  resolveSymbol,
  type HoleSite,
  type SiteTable,
} from "../analysis/sites.js";
import { collectHoleDiagnostics } from "../analysis/hole-sites.js";
import { lowerHoleCall, printHoleBodies, TRANSPILE_OPTIONS } from "./lower-hole.js";

export const HOST_BINDING = "__host";

const HOST_PASSTHROUGH_FUNCTIONS: ReadonlySet<string> = new Set(["log", "channel", "future"]);

export interface LoweredWorkflow {
  
  code: string;
  
  siteIds: string[];
  
  holeBodies: Record<string, string>;
}

export interface LowerResult {
  diagnostics: CompileDiagnostic[];
  ok: boolean;
  lowered?: LoweredWorkflow;
}

type SiteEmit =
  | { kind: "actor"; siteId: string }
  | { kind: "artifact"; siteId: string; op: ArtifactOp }
  | { kind: "ask"; siteId: string }
  
  | { kind: "hole"; site: HoleSite }
  
  | { kind: "phase"; name: string | undefined }
  | { kind: "report"; siteId: string }
  | { kind: "world-read"; siteId: string; op: WorldReadOp };

export function lowerWorkflowScript(scriptText: string): LowerResult {
  const workflow = createWorkflowProgram(scriptText);
  const diagnostics = collectDiagnostics(workflow.program);
  if (diagnostics.length > 0) return { diagnostics, ok: false };

  const table = collectSites(workflow);
  const misuse = [
    ...collectFacadeMisuse(workflow, table),
    ...collectHoleDiagnostics(workflow, table),
  ];
  if (misuse.length > 0) return { diagnostics: misuse, ok: false };

  return { diagnostics, lowered: lowerWorkflow(workflow, table), ok: true };
}

export function lowerWorkflow(workflow: WorkflowProgram, table: SiteTable): LoweredWorkflow {
  const checker = workflow.program.getTypeChecker();
  const siteMap = buildSiteMap(table);
  const holeBodyNodes = new Map<string, ts.Expression>();

  const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
    const { factory } = context;
    const hostMember = (name: string): ts.Expression =>
      factory.createPropertyAccessExpression(factory.createIdentifier(HOST_BINDING), name);
    const siteArg = (id: string): ts.Expression => factory.createStringLiteral(id);

    const visit: ts.Visitor = (node) => {
      //
      if (ts.isIdentifier(node) && node.text === "args" && isFacadeArgsRead(node, checker)) {
        return hostMember("args");
      }
      if (ts.isCallExpression(node)) {
        const emit = siteMap.get(node);
        if (emit !== undefined) return lowerSited(node, emit);
        const name = facadeCalleeName(node, checker);
        if (name === "model") {
          const arg = node.arguments[0];
          return arg === undefined ? factory.createVoidZero() : visitExpr(arg);
        }
        if (name !== undefined && HOST_PASSTHROUGH_FUNCTIONS.has(name)) {
          return factory.createCallExpression(
            hostMember(name),
            undefined,
            node.arguments.map(visitExpr),
          );
        }
      }
      return ts.visitEachChild(node, visit, context);
    };

    const visitExpr = (expr: ts.Expression): ts.Expression =>
      ts.visitNode(expr, visit) as ts.Expression;

    const lowerSited = (call: ts.CallExpression, emit: SiteEmit): ts.Expression => {
      if (emit.kind === "phase") {
        const name = emit.name?.trim();
        if (name === undefined || name.length === 0) return factory.createVoidZero();
        return factory.createCallExpression(hostMember("enterPhase"), undefined, [
          factory.createStringLiteral(name),
        ]);
      }
      if (emit.kind === "hole") {
        return lowerHoleCall(
          call,
          emit.site,
          factory,
          hostMember,
          siteArg,
          visitExpr,
          holeBodyNodes,
        );
      }
      if (emit.kind === "actor") {
        // agent(name?, persona?) -> __host.createActor(siteId, name?, persona?)
        return factory.createCallExpression(hostMember("createActor"), undefined, [
          siteArg(emit.siteId),
          ...call.arguments.map(visitExpr),
        ]);
      }
      if (emit.kind === "ask") {
        const access = call.expression as ts.PropertyAccessExpression;
        const receiver = visitExpr(access.expression);
        const loweredAsk = (recv: ts.Expression): ts.Expression =>
          factory.createCallExpression(hostMember("ask"), undefined, [
            siteArg(emit.siteId),
            recv,
            ...call.arguments.map(visitExpr),
          ]);
        if (!ts.isOptionalChain(call)) return loweredAsk(receiver);
        const once = ts.isIdentifier(receiver)
          ? receiver
          : factory.createTempVariable(context.hoistVariableDeclaration);
        const evaluated = once === receiver ? receiver : factory.createAssignment(once, receiver);
        const isNullish = factory.createBinaryExpression(
          factory.createBinaryExpression(
            evaluated,
            factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
            factory.createNull(),
          ),
          factory.createToken(ts.SyntaxKind.BarBarToken),
          factory.createBinaryExpression(
            once,
            factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
            factory.createIdentifier("undefined"),
          ),
        );
        return factory.createConditionalExpression(
          isNullish,
          factory.createToken(ts.SyntaxKind.QuestionToken),
          factory.createIdentifier("undefined"),
          factory.createToken(ts.SyntaxKind.ColonToken),
          loweredAsk(once),
        );
      }
      if (emit.kind === "artifact") {
        // artifact.file(id, path, opts)  -> __host.publishArtifact(siteId, "file", [id, path, opts])
        // artifact.chart(id, spec)       -> __host.declareArtifact(siteId, "chart", [id, spec])
        const member = isArtifactPresetOp(emit.op) ? "declareArtifact" : "publishArtifact";
        return factory.createCallExpression(hostMember(member), undefined, [
          siteArg(emit.siteId),
          factory.createStringLiteral(emit.op),
          factory.createArrayLiteralExpression(call.arguments.map(visitExpr)),
        ]);
      }
      if (emit.kind === "report") {
        // report(item, artifactId?) -> __host.report(siteId, item, artifactId?)
        return factory.createCallExpression(hostMember("report"), undefined, [
          siteArg(emit.siteId),
          ...call.arguments.map(visitExpr),
        ]);
      }
      // files.glob(arg)/files.read(arg) -> __host.worldRead(siteId, op, [arg])
      return factory.createCallExpression(hostMember("worldRead"), undefined, [
        siteArg(emit.siteId),
        factory.createStringLiteral(emit.op),
        factory.createArrayLiteralExpression(call.arguments.map(visitExpr)),
      ]);
    };

    return (sourceFile) => ts.visitNode(sourceFile, visit) as ts.SourceFile;
  };

  const result = ts.transform(workflow.scriptFile, [transformer]);
  const transformed = result.transformed[0];
  if (transformed === undefined) throw new Error("lowering: transform produced no source file");

  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: false });
  const instrumented = workflowBody(transformed)
    .map((statement) => printer.printNode(ts.EmitHint.Unspecified, statement, transformed))
    .join("\n");
  const holeBodies = printHoleBodies(holeBodyNodes, printer, transformed);
  result.dispose();

  const code = ts.transpileModule(instrumented, {
    compilerOptions: TRANSPILE_OPTIONS,
    reportDiagnostics: false,
  }).outputText;

  return { code, holeBodies, siteIds: sourceOrderSiteIds(table) };
}

function buildSiteMap(table: SiteTable): Map<ts.CallExpression, SiteEmit> {
  const map = new Map<ts.CallExpression, SiteEmit>();
  for (const site of table.actors) map.set(site.call, { kind: "actor", siteId: site.id });
  for (const site of table.artifacts) {
    map.set(site.call, { kind: "artifact", op: site.op, siteId: site.id });
  }
  for (const site of table.asks) map.set(site.call, { kind: "ask", siteId: site.id });
  for (const site of table.holes) map.set(site.call, { kind: "hole", site });
  for (const marker of table.phases) map.set(marker.call, { kind: "phase", name: marker.name });
  for (const site of table.reports) map.set(site.call, { kind: "report", siteId: site.id });
  for (const site of table.worldReads) {
    map.set(site.call, { kind: "world-read", op: site.op, siteId: site.id });
  }
  return map;
}

function sourceOrderSiteIds(table: SiteTable): string[] {
  const sited = [
    ...table.actors,
    ...table.artifacts,
    ...table.asks,
    ...table.holes,
    ...table.reports,
    ...table.worldReads,
  ];
  return sited.sort((a, b) => a.order - b.order).map((site) => site.id);
}

function workflowBody(sourceFile: ts.SourceFile): ts.NodeArray<ts.Statement> {
  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === WORKFLOW_FUNCTION_NAME &&
      statement.body !== undefined
    ) {
      return statement.body.statements;
    }
  }
  throw new Error(`lowering: ${WORKFLOW_FUNCTION_NAME} not found in transformed source`);
}

/**
 * True iff this `args` identifier is a READ of the facade global (not a shadowing local,
 * not a property name, not a declaration site).
 *
 * Identity comes from the checker, exactly as facade call sites do: a script that writes
 * its own `const args = ...` resolves to a symbol declared in the script file, so it is
 * left alone and keeps shadowing benignly. The syntactic guards below are for positions
 * where an identifier is not a value read at all — `x.args`, `{ args: 1 }`, and the name
 * in `const args = ...` — where rewriting would produce nonsense like `{ __host.args: 1 }`.
 */
function isFacadeArgsRead(node: ts.Identifier, checker: ts.TypeChecker): boolean {
  const parent = node.parent as ts.Node | undefined;
  if (parent !== undefined) {
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
    if (ts.isQualifiedName(parent) && parent.right === node) return false;
    if (
      (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) &&
      parent.name === node
    ) {
      return false;
    }
    if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) return false;
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
  }
  return isFacadeDeclared(resolveSymbol(node, checker));
}

function facadeCalleeName(call: ts.CallExpression, checker: ts.TypeChecker): string | undefined {
  const declaration = checker.getResolvedSignature(call)?.declaration;
  if (declaration === undefined || declaration.getSourceFile().fileName !== FACADE_FILE_NAME) {
    return undefined;
  }
  const name = (declaration as ts.FunctionDeclaration | ts.MethodSignature).name;
  return name !== undefined && ts.isIdentifier(name) ? name.text : undefined;
}
