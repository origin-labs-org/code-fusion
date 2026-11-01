import ts from "typescript";
import type { CompileDiagnostic, WorkflowProgram } from "../compiler/compile.js";
import { collectSites, type SiteTable } from "../analysis/sites.js";
import { createWorkflowProgram, collectDiagnostics } from "../compiler/compile.js";
import type { AskSpec } from "../engine/types.js";
import { SchemaEmitter, SchemaRejection } from "./emit.js";
import { harvestConstraints, mergeConstraints } from "./jsdoc.js";
import type { JsonSchema } from "./types.js";
import { SCHEMA_DIAGNOSTIC_CODE } from "./types.js";

export interface SchemaSynthesisResult {
  
  schemas: Record<string, JsonSchema>;
  
  diagnostics: CompileDiagnostic[];
}

function askResultType(checker: ts.TypeChecker, call: ts.CallExpression): ts.Type | undefined {
  const typeNode = call.typeArguments?.[0];
  if (typeNode === undefined) return undefined;
  const type = checker.getTypeFromTypeNode(typeNode);
  return (type.flags & ts.TypeFlags.String) !== 0 ? undefined : type;
}

export function synthesizeAskSchemas(
  workflow: WorkflowProgram,
  table: SiteTable,
): SchemaSynthesisResult {
  const checker = workflow.program.getTypeChecker();
  const schemas: Record<string, JsonSchema> = {};
  const diagnostics: CompileDiagnostic[] = [];

  for (const site of table.asks) {
    const type = askResultType(checker, site.call);
    if (type === undefined) continue;

    try {
      const typeNode = site.call.typeArguments![0]!;
      const emitter = new SchemaEmitter(checker, typeNode);
      schemas[site.id] = attachTopDoc(emitter.emitTop(type), type, checker);
    } catch (error) {
      if (!(error instanceof SchemaRejection)) throw error;
      diagnostics.push({
        code: SCHEMA_DIAGNOSTIC_CODE,
        column: site.loc.column,
        line: site.loc.line,
        message: rejectionMessage(error, "ask result type"),
      });
    }
  }

  for (const site of table.reports) diagnostics.push(...reportItemDiagnostics(checker, site));

  return { diagnostics, schemas };
}

function reportItemDiagnostics(
  checker: ts.TypeChecker,
  site: SiteTable["reports"][number],
): CompileDiagnostic[] {
  if (site.item === undefined) return [];
  try {
    new SchemaEmitter(checker, site.item).emitTop(checker.getTypeAtLocation(site.item));
    return [];
  } catch (error) {
    if (!(error instanceof SchemaRejection)) throw error;
    return [
      {
        code: SCHEMA_DIAGNOSTIC_CODE,
        column: site.loc.column,
        line: site.loc.line,
        message: rejectionMessage(error, "report item type"),
      },
    ];
  }
}

export function synthesizeWorkflowSchemas(scriptText: string): SchemaSynthesisResult {
  const workflow = createWorkflowProgram(scriptText);
  const compileDiagnostics = collectDiagnostics(workflow.program);
  if (compileDiagnostics.length > 0) return { diagnostics: compileDiagnostics, schemas: {} };
  return synthesizeAskSchemas(workflow, collectSites(workflow));
}

export function buildAskSpecs(table: SiteTable, schemas: Record<string, JsonSchema>): Map<string, AskSpec> {
  const specs = new Map<string, AskSpec>();
  for (const site of table.asks) {
    const schema = schemas[site.id];
    specs.set(site.id, schema === undefined ? { typed: false } : { typed: true, schema });
  }
  return specs;
}

function attachTopDoc(schema: JsonSchema, type: ts.Type, checker: ts.TypeChecker): JsonSchema {
  const symbol = type.aliasSymbol ?? type.getSymbol();
  if (symbol === undefined) return schema;
  return mergeConstraints(schema, harvestConstraints(symbol, checker));
}

function rejectionMessage(error: SchemaRejection, subject: string): string {
  const where = error.path !== "$" && error.path.length > 0 ? ` (at ${error.path})` : "";
  return `unsupported ${subject}: ${error.reason}${where}`;
}
