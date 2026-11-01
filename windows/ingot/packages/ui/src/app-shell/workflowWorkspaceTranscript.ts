// ============================================================
// ============================================================
//

import type { WorkflowRunState, WorkflowRunWorkspaceNode } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { WorkflowCausalityGraphData } from "@/components/workflow-graph/types.js";
import type { PhaseNaming } from "@/components/workflow-graph/phase-name.js";

export type WorkspaceCardKind = "read" | "search" | "git" | "terminal" | "step";

export interface WorkspaceCardModel {
  
  key: string;
  node: WorkflowRunWorkspaceNode;
  kind: WorkspaceCardKind;
  op: string | undefined;
  
  primary: string;
  
  secondary?: string;
  
  command?: string;
  
  phase?: PhaseNaming;
  
  round: number;
}

interface WorkspaceCardStatus {
  status: WorkflowRunWorkspaceNode["status"];
  
  replayed: boolean;
}

function argString(args: readonly unknown[] | undefined, index: number): string | undefined {
  const value = args?.[index];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function argList(args: readonly unknown[] | undefined, index: number): string[] {
  const value = args?.[index];
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "string" && value.startsWith("[")) return [value];
  return [];
}

export function formatCommandLine(cmd: string, args: readonly string[]): string {
  const quote = (part: string) => (/[\s"']/.test(part) ? JSON.stringify(part) : part);
  return [cmd, ...args].map(quote).join(" ");
}

export function workspaceCardKindOf(op: string | undefined): WorkspaceCardKind {
  if (op === undefined) return "step";
  if (op === "read") return "read";
  if (op === "glob" || op === "grep") return "search";
  if (op.startsWith("git-")) return "git";
  if (op === "run") return "terminal";
  return "step";
}

function gitSubcommand(op: string): string {
  return op.slice("git-".length);
}

function phaseBySiteId(
  graph: WorkflowCausalityGraphData | undefined,
): Map<string, PhaseNaming> {
  const table = new Map<string, PhaseNaming>();
  if (graph === undefined) return table;
  const phases = new Map((graph.phases ?? []).map((phase) => [phase.id, phase] as const));
  for (const step of graph.steps) {
    if (step.phase === undefined) continue;
    const phase = phases.get(step.phase);
    if (phase === undefined) continue;
    table.set(step.source ?? step.id, { id: phase.id, name: phase.name });
  }
  return table;
}

function stepLabelBySiteId(
  graph: WorkflowCausalityGraphData | undefined,
): Map<string, string> {
  const table = new Map<string, string>();
  for (const step of graph?.steps ?? []) table.set(step.source ?? step.id, step.label);
  return table;
}

export function buildWorkspaceCards(
  nodes: readonly WorkflowRunWorkspaceNode[],
  graph: WorkflowCausalityGraphData | undefined,
): WorkspaceCardModel[] {
  const phases = phaseBySiteId(graph);
  const labels = stepLabelBySiteId(graph);
  return nodes.map((node) => {
    const op = node.op;
    const kind = workspaceCardKindOf(op);
    const phase = phases.get(node.siteId);
    const base = {
      key: `${node.siteId}@${node.ordinal}`,
      node,
      kind,
      op,
      round: node.ordinal,
      ...(phase === undefined ? {} : { phase }),
    };
    const fallback = labels.get(node.siteId) ?? node.siteId;
    switch (kind) {
      case "read":
        return { ...base, primary: argString(node.args, 0) ?? fallback };
      case "search": {
        const scope = argString(node.args, 1);
        return {
          ...base,
          primary: argString(node.args, 0) ?? fallback,
          ...(scope === undefined ? {} : { secondary: scope }),
        };
      }
      case "git": {
        const sub = gitSubcommand(op!);
        const target = argString(node.args, 0);
        const shown = node.args?.map((arg) =>
          typeof arg === "string" ? arg : JSON.stringify(arg),
        );
        return {
          ...base,
          primary: `git ${formatCommandLine(sub, shown ?? [])}`,
          ...(target === undefined ? {} : { secondary: target }),
        };
      }
      case "terminal": {
        const cmd = argString(node.args, 0) ?? fallback;
        const command = formatCommandLine(cmd, argList(node.args, 1));
        return { ...base, primary: command, command };
      }
      default:
        return { ...base, primary: fallback };
    }
  });
}

export function workspaceCardStatus(
  node: WorkflowRunWorkspaceNode,
  run: WorkflowRunState | undefined,
): WorkspaceCardStatus {
  const live = run?.nodes.find(
    (candidate) => candidate.siteId === node.siteId && candidate.ordinal === node.ordinal,
  );
  return { status: node.status, replayed: live?.cached === true };
}

export function firstCardIndexOfPhase(
  cards: readonly WorkspaceCardModel[],
  phaseId: string,
): number {
  return cards.findIndex((card) => card.phase?.id === phaseId);
}

export function formatWorkspaceDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function formatWorkspaceBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isTimeoutError(error: { code: string; message: string } | undefined): boolean {
  if (error === undefined) return false;
  return /timeout|timed ?out/i.test(error.code) || /timed out|timeout/i.test(error.message);
}
