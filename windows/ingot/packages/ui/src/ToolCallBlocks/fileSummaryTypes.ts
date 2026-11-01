import type { PluginUiToolBinding } from "@/plugin-ui/contract.js";
import type { ComponentType, ReactNode } from "react";
import type { WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { MessageFileLinkTarget } from "@/components/ai-elements/message.js";
import type { CodePreviewSettings } from "@/lib/codePreviewSettings.js";
import type { CodeViewerSource } from "@/lib/codeViewer.js";
import { countPatchFileDiffs } from "@/lib/patchDiffPreview.js";
import type { TaskChatToolCallTreeNode } from "@/lib/toolCallTree.js";
import type { ToolDisplayModel } from "@/lib/toolDisplay.js";
import type { Theme } from "@/useTheme.js";
import type { OpenPlanDetailSideTabRequest } from "@/lib/workspaceSidePane.js";
import type { ToolCallBlock } from "@/ToolCallBlocks.js";

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readStringField(
  value: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return undefined;
}

export function readUnifiedDiffField(value: unknown): string | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }

  return readStringField(value, ["unified_diff", "unifiedDiff", "patch", "diff"]);
}

export function normalizeSingleFilePatch(
  patch: string | undefined,
  fileLabel: string,
): string | undefined {
  if (!patch) {
    return undefined;
  }

  const trimmedPatch = patch.trim();
  if (!trimmedPatch) {
    return undefined;
  }

  if (countPatchFileDiffs(trimmedPatch) > 1) {
    return undefined;
  }

  if (/^---\s+/m.test(trimmedPatch) && /^\+\+\+\s+/m.test(trimmedPatch)) {
    return trimmedPatch;
  }

  if (trimmedPatch.startsWith("@@ ")) {
    const firstHeader = trimmedPatch.match(/^@@\s-(\d+)(?:,(\d+))?\s\+(\d+)(?:,(\d+))?\s@@/m);
    const deletedCount = Number(firstHeader?.[2] ?? firstHeader?.[1] ?? "1");
    const addedCount = Number(firstHeader?.[4] ?? firstHeader?.[3] ?? "1");

    return [
      deletedCount === 0 && addedCount > 0 ? "--- /dev/null" : `--- a/${fileLabel}`,
      addedCount === 0 && deletedCount > 0 ? "+++ /dev/null" : `+++ b/${fileLabel}`,
      trimmedPatch,
    ].join("\n");
  }

  return trimmedPatch;
}

export function readRawToolCallInput(raw: unknown): unknown {
  if (!isPlainRecord(raw)) {
    return null;
  }

  if ("rawInput" in raw && raw.rawInput !== undefined) {
    return raw.rawInput;
  }

  return "input" in raw ? raw.input : null;
}

export function readStructuredDiffBlock(
  value: unknown,
): { path?: string; oldText: string; newText: string } | null {
  if (!isPlainRecord(value) || value.type !== "diff" || typeof value.newText !== "string") {
    return null;
  }

  return {
    path: typeof value.path === "string" && value.path.trim() ? value.path : undefined,
    oldText:
      typeof value.oldText === "string"
        ? value.oldText
        : value.oldText == null
          ? ""
          : String(value.oldText),
    newText: value.newText,
  };
}

export function readRawToolCallChanges(raw: unknown) {
  if (!isPlainRecord(raw)) {
    return {
      directChanges: null,
      rawInputChanges: null,
      rawOutputChanges: null,
    };
  }

  const rawInputSource = readRawToolCallInput(raw);
  const rawInput = isPlainRecord(rawInputSource) ? rawInputSource : null;
  const rawOutput = isPlainRecord(raw.rawOutput) ? raw.rawOutput : null;

  return {
    directChanges: isPlainRecord(raw.changes) ? raw.changes : null,
    rawInputChanges: rawInput && isPlainRecord(rawInput.changes) ? rawInput.changes : null,
    rawOutputChanges: rawOutput && isPlainRecord(rawOutput.changes) ? rawOutput.changes : null,
  };
}

export interface RawToolCallFileSummary {
  path: string;
  actionLabel: "Created" | "Edited" | "Deleted";
  operationKind: EditOperationKind;
  fileName: string;
  filePath: string | null;
  fileIconSrc: string;
  changeStat?: { added: number; removed: number };
  patch?: string | null;
}

export interface WorkflowRunCardSummary {
  runId: string;
  
  toolCallId?: string;
  status: WorkflowRunState["status"];
  
  stopReason?: WorkflowRunState["stopReason"];
  
  nodesSettled: number;
  
  nodesTotal: number;
  
  agents?: number;
  
  run?: WorkflowRunState;
  
  resumable?: true;
}

export interface WorkflowDraftPosition {
  
  ordinal: number;
  
  superseded: boolean;
}

export interface ToolCallBlockRenderContext {
  nestedToolRenderer: ComponentType<Parameters<typeof ToolCallBlock>[0]>;
  isOfficeMode?: boolean;
  toolCallNode: TaskChatToolCallTreeNode;
  workspacePath: string;
  
  pluginUi?: PluginUiToolBinding;
  
  theme?: Theme;
  
  codePreviewSettings?: CodePreviewSettings;
  displayModel: ToolDisplayModel;
  viewerSource: CodeViewerSource | null;
  rawFileSummaries: RawToolCallFileSummary[];
  isRunning: boolean;
  
  isPermissionPreview?: boolean;
  statusLabel: string;
  sourceLabel?: string;
  errorText?: string;
  childToolList: ReactNode;
  showIcon?: boolean;
  
  cuaAppIconClassName?: "size-4" | "size-5";
  kindLabelOverride?: ReactNode;
  showTodoToolCalls?: boolean;
  disableSummaryContentAnimation?: boolean;
  
  animateDiffCountOnMount?: boolean;
  canToggle?: boolean;
  forceOpen?: boolean;
  
  agentSummaryAction?: {
    onActivate: () => void;
    testId?: string;
  };
  
  authoritativeAgentType?: string;
  
  onOpenPlanDetail?: (request: Omit<OpenPlanDetailSideTabRequest, "parentSessionId">) => void;
  
  onOpenWorkflowRun?: (request: { workflowName?: string; phaseId?: string }) => void;
  
  onResumeWorkflowRun?: (request: { workflowName?: string }) => void;
  
  onOpenWorkflowActor?: (request: {
    runId: string;
    actorSessionId?: string;
    siteId: string;
    ordinal: number;
    actorName?: string;
  }) => void;
  
  onOpenWorkflowWorkspace?: (request: { phaseId: string; workflowName?: string }) => void;
  
  onOpenWorkflowArtifact?: (artifactId: string) => void;
  
  workflowRun?: WorkflowRunCardSummary;
  
  workflowDraft?: WorkflowDraftPosition;
  onOpenCodeViewer?: (source: CodeViewerSource) => void;
  onOpenFileLink?: (target: MessageFileLinkTarget) => void;
  onOpenBrowserUrl?: (url: string) => void;
  
  onOpenAutomationsMain?: (automationId?: string) => void;
  onLoadFullToolCallFields?: (toolId: string) => Promise<boolean | void> | boolean | void;
}

export interface EditKindSource {
  toolName?: string | null;
  kind?: string | null;
  title?: string | null;
  input?: unknown;
  output?: unknown;
  raw?: unknown;
}

export type EditOperationKind = "write" | "edit" | "update" | "delete";
export type EditKindLabelId =
  | "chat.toolCall.edit.writing"
  | "chat.toolCall.edit.updating"
  | "chat.toolCall.edit.deleting"
  | "chat.toolCall.edit.editing"
  | "chat.toolCall.kind.write"
  | "chat.toolCall.kind.delete"
  | "chat.toolCall.kind.edit";
