// ============================================================
// ============================================================
//
//
//
//
//

import type { DwfRunIntrospectionQueries, DwfWorldNodeRow } from "@origin-ai/cf-adapters/storage";
import type {
  DynamicWorkflowRunError,
  DynamicWorkflowRunWorkspaceNode,
  DynamicWorkflowRunWorkspaceNodeResult,
  DynamicWorkflowRunWorkspaceNodeResultQuery,
  DynamicWorkflowRunWorkspaceNodeSummary,
} from "@origin-ai/cf-contracts";
import type { JournalStorePort, NodeRecord } from "@origin-ai/cf-dynamic-workflow";

const ERROR_MESSAGE_MAX_CHARS = 2000;

interface WorkspaceReadableJournal
  extends JournalStorePort, Pick<DwfRunIntrospectionQueries, "listWorldNodes"> {}

export function supportsWorkspaceReads(
  journal: JournalStorePort,
): journal is WorkspaceReadableJournal {
  return typeof (journal as Partial<DwfRunIntrospectionQueries>).listWorldNodes === "function";
}

interface WorkflowWorkspaceReadDeps {
  journal: JournalStorePort;
  
  parentSessionId: string;
}

function authorizeRun(deps: WorkflowWorkspaceReadDeps, runId: string): boolean {
  const run = deps.journal.getRun(runId);
  if (run === undefined) return false;
  return run.parentSessionId !== undefined && run.parentSessionId === deps.parentSessionId;
}

export async function listWorkspaceNodesFrom(
  deps: WorkflowWorkspaceReadDeps,
  runId: string,
): Promise<readonly DynamicWorkflowRunWorkspaceNode[] | undefined> {
  if (!supportsWorkspaceReads(deps.journal)) return undefined;
  if (!authorizeRun(deps, runId)) return undefined;
  return deps.journal.listWorldNodes(runId).map(toWorkspaceNode);
}

function toWorkspaceNode(row: DwfWorldNodeRow): DynamicWorkflowRunWorkspaceNode {
  const summary = summaryOf(row);
  return {
    siteId: row.siteId,
    ordinal: row.ordinal,
    kind: row.kind === "world-run" ? "world-run" : "world-read",
    ...(row.input === undefined
      ? {}
      : {
          op: row.input.op,
          args: row.input.args,
          ...(row.input.truncated === true ? { inputTruncated: true as const } : {}),
        }),
    status: row.status,
    ...(row.error === undefined ? {} : { error: toRunError(row.error) }),
    ...(summary === undefined ? {} : { summary }),
    createdAt: row.timeCreated,
    updatedAt: row.timeUpdated,
  };
}

function summaryOf(row: DwfWorldNodeRow): DynamicWorkflowRunWorkspaceNodeSummary | undefined {
  if (row.status !== "completed" || row.resultBytes === undefined) return undefined;
  return {
    resultBytes: row.resultBytes,
    ...(row.resultCount === undefined ? {} : { resultCount: row.resultCount }),
    ...(row.exitCode === undefined ? {} : { exitCode: row.exitCode }),
    ...(row.stdoutBytes === undefined ? {} : { stdoutBytes: row.stdoutBytes }),
    ...(row.stderrBytes === undefined ? {} : { stderrBytes: row.stderrBytes }),
  };
}

function toRunError(error: { code: string; message: string }): DynamicWorkflowRunError {
  const message =
    error.message.length > ERROR_MESSAGE_MAX_CHARS
      ? `${error.message.slice(0, ERROR_MESSAGE_MAX_CHARS - 1)}…`
      : error.message;
  return { code: error.code, message };
}

export async function readWorkspaceNodeResultFrom(
  deps: WorkflowWorkspaceReadDeps,
  runId: string,
  siteId: string,
  ordinal: number,
  query: DynamicWorkflowRunWorkspaceNodeResultQuery,
): Promise<DynamicWorkflowRunWorkspaceNodeResult | undefined> {
  if (!authorizeRun(deps, runId)) return undefined;
  const node = deps.journal.getNode(runId, siteId, ordinal);
  if (node === undefined) return undefined;
  if (node.kind !== "world-read" && node.kind !== "world-run") return undefined;
  return toNodeResult(node, query.maxBytes);
}

function toNodeResult(node: NodeRecord, maxBytes: number): DynamicWorkflowRunWorkspaceNodeResult {
  if (node.status === "failed") {
    return {
      status: "failed",
      ...(node.error === undefined ? {} : { error: toRunError(node.error) }),
      truncated: false,
      totalBytes: 0,
    };
  }
  if (node.status !== "completed" || !("result" in node)) {
    return { status: node.status, truncated: false, totalBytes: 0 };
  }
  const bounded = boundWorkspaceResult(node.result, maxBytes);
  return {
    status: "completed",
    result: bounded.result,
    truncated: bounded.truncated,
    totalBytes: bounded.totalBytes,
  };
}

function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function truncateUtf8(text: string, maxBytes: number): string {
  if (utf8ByteLength(text) <= maxBytes) return text;
  const bytes = Buffer.from(text, "utf8").subarray(0, Math.max(0, maxBytes));
  let end = bytes.length;
  while (end > 0 && (bytes[end - 1]! & 0b1100_0000) === 0b1000_0000) end -= 1;
  if (end > 0 && (bytes[end - 1]! & 0b1100_0000) === 0b1100_0000) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}

export function boundWorkspaceResult(
  result: unknown,
  maxBytes: number,
): { result: unknown; truncated: boolean; totalBytes: number } {
  const serialized = JSON.stringify(result) ?? "null";
  const totalBytes = utf8ByteLength(serialized);
  if (totalBytes <= maxBytes) return { result, truncated: false, totalBytes };

  if (typeof result === "string") {
    return { result: truncateUtf8(result, maxBytes), truncated: true, totalBytes };
  }
  if (Array.isArray(result)) {
    const kept: unknown[] = [];
    let used = 2;
    for (const item of result) {
      const itemBytes = utf8ByteLength(JSON.stringify(item) ?? "null") + 1;
      if (used + itemBytes > maxBytes) break;
      kept.push(item);
      used += itemBytes;
    }
    return { result: kept, truncated: true, totalBytes };
  }
  if (isRunResult(result)) {
    const overhead = utf8ByteLength(JSON.stringify({ ...result, stdout: "", stderr: "" }));
    const budget = Math.max(0, maxBytes - overhead);
    const stderrWant = utf8ByteLength(result.stderr);
    const stdoutWant = utf8ByteLength(result.stdout);
    const stderrBudget = Math.min(stderrWant, Math.max(budget >> 1, budget - stdoutWant));
    const stdoutBudget = Math.max(0, budget - stderrBudget);
    return {
      result: {
        ...result,
        stdout: truncateUtf8(result.stdout, stdoutBudget),
        stderr: truncateUtf8(result.stderr, stderrBudget),
      },
      truncated: true,
      totalBytes,
    };
  }
  return { result: truncateUtf8(serialized, maxBytes), truncated: true, totalBytes };
}

function isRunResult(
  value: unknown,
): value is { exitCode: number; stdout: string; stderr: string } & Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  return (
    typeof fields.exitCode === "number" &&
    typeof fields.stdout === "string" &&
    typeof fields.stderr === "string"
  );
}
