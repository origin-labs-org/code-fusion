import type { TaskChatToolCall as ChatToolCall } from "@/lib/taskChatMessageTypes.js";
import {
  getToolCallCodeContentPreview,
  getToolCallCodePreview,
  type CodeViewerSource,
  type ImageCodeViewerSource,
  type PatchCodeViewerSource,
  type TextCodeViewerSource,
} from "@/lib/codeViewer.js";
import { isAbsoluteFilePath, joinFilePath } from "@/lib/path.js";
import { getToolCallErrorText } from "@/lib/toolError.js";
import {
  isFileContentWriteToolCall,
  isFileDiffToolCall,
  resolveToolCallIdentity,
  type ToolCallIdentity,
} from "@/lib/toolIdentity.js";

export type ToolInlinePreview =
  | { type: "none" }
  | { type: "text"; source: TextCodeViewerSource }
  | { type: "patch"; source: PatchCodeViewerSource }
  | { type: "image"; source: ImageCodeViewerSource };

export interface ToolPlanResult {
  plan: string;
  planFilePath?: string;
}

export interface ToolDisplayModel {
  inlinePreview: ToolInlinePreview;
  planResult: ToolPlanResult | null;
  viewerSource: CodeViewerSource | null;
  viewerLabelId: "codeViewer.viewCode" | "codeViewer.viewDiff";
  showSummaryFileLink: boolean;
  showInput: boolean;
  showOutput: boolean;
  showKind: boolean;
}

interface ToolDisplayContext {
  toolCall: ChatToolCall;
  identity: ToolCallIdentity;
  preview: CodeViewerSource | null;
  contentPreview: TextCodeViewerSource | null;
  errorText?: string;
}

interface ToolDisplayStrategy {
  matches(context: ToolDisplayContext): boolean;
  build(context: ToolDisplayContext): Partial<ToolDisplayModel>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractToolPlanResultFromValue(
  value: unknown,
  workspacePath: string,
): ToolPlanResult | null {
  if (!isRecord(value)) {
    return null;
  }

  const rawPlan = value["plan"];
  if (typeof rawPlan !== "string" || rawPlan.trim().length === 0) {
    return null;
  }

  const rawPlanFilePath = value["planFilePath"];
  const planFilePath =
    typeof rawPlanFilePath === "string" && rawPlanFilePath.trim().length > 0
      ? isAbsoluteFilePath(rawPlanFilePath)
        ? rawPlanFilePath
        : joinFilePath(workspacePath, rawPlanFilePath)
      : undefined;

  return {
    plan: rawPlan.trim(),
    planFilePath,
  };
}

function toInlinePreview(context: ToolDisplayContext, preferPatch: boolean): ToolInlinePreview {
  if (preferPatch && context.preview?.type === "patch") {
    return {
      type: "patch",
      source: context.preview,
    };
  }

  if (context.preview?.type === "image") {
    return {
      type: "image",
      source: context.preview,
    };
  }

  if (context.preview?.type === "text") {
    return {
      type: "text",
      source: context.preview,
    };
  }

  if (context.contentPreview) {
    return {
      type: "text",
      source: context.contentPreview,
    };
  }

  return { type: "none" };
}

const diffToolStrategy: ToolDisplayStrategy = {
  matches(context) {
    return isFileDiffToolCall(context.toolCall, context.identity);
  },
  build(context) {
    const inlinePreview = toInlinePreview(context, true);
    const hasInlinePreview = inlinePreview.type !== "none";

    return {
      inlinePreview,
      showInput: !hasInlinePreview,
      showOutput: Boolean(context.errorText),
      showKind: !hasInlinePreview,
    };
  },
};

const readToolStrategy: ToolDisplayStrategy = {
  matches(context) {
    return context.identity.family === "file-read";
  },
  build(context) {
    const inlinePreview = toInlinePreview(context, false);
    const hasInlinePreview = inlinePreview.type !== "none";

    return {
      inlinePreview,
      showSummaryFileLink: false,
      showInput: !hasInlinePreview,
      showOutput: Boolean(context.errorText),
      showKind: !hasInlinePreview,
    };
  },
};

const writeToolStrategy: ToolDisplayStrategy = {
  matches(context) {
    return isFileContentWriteToolCall(context.toolCall, context.identity);
  },
  build(context) {
    const inlinePreview = toInlinePreview(context, false);
    const hasInlinePreview = inlinePreview.type !== "none";

    return {
      inlinePreview,
      showInput: !hasInlinePreview,
      showOutput: Boolean(context.errorText),
      showKind: !hasInlinePreview,
    };
  },
};

const genericImageStrategy: ToolDisplayStrategy = {
  matches(context) {
    return context.preview?.type === "image";
  },
  build(context) {
    const inlinePreview = toInlinePreview(context, false);
    const hasInlinePreview = inlinePreview.type !== "none";

    return {
      inlinePreview,
      showInput: !hasInlinePreview,
      showOutput: Boolean(context.errorText),
      showKind: !hasInlinePreview,
    };
  },
};

const executeToolStrategy: ToolDisplayStrategy = {
  matches(context) {
    return context.identity.family === "shell";
  },
  build(context) {
    return {
      inlinePreview: { type: "none" },
      showInput: false,
      showOutput: context.toolCall.output !== undefined || Boolean(context.errorText),
      showKind: false,
    };
  },
};

const searchToolStrategy: ToolDisplayStrategy = {
  matches(context) {
    return context.identity.family === "search" || context.identity.family === "web-fetch";
  },
  build(context) {
    return {
      inlinePreview: { type: "none" },
      showSummaryFileLink: false,
      showInput: false,
      showOutput: context.toolCall.output !== undefined || Boolean(context.errorText),
      showKind: false,
    };
  },
};

const goalToolStrategy: ToolDisplayStrategy = {
  matches(context) {
    return context.identity.family === "goal";
  },
  build(context) {
    return {
      inlinePreview: { type: "none" },
      showSummaryFileLink: false,
      showInput: false,
      showOutput: context.toolCall.output !== undefined || Boolean(context.errorText),
      showKind: false,
    };
  },
};

const nodeReplToolStrategy: ToolDisplayStrategy = {
  matches(context) {
    return context.identity.family === "node-repl";
  },
  build() {
    return {
      inlinePreview: { type: "none" },
      showSummaryFileLink: false,
      showInput: false,
      showOutput: false,
      showKind: false,
    };
  },
};

const TOOL_DISPLAY_STRATEGIES: ToolDisplayStrategy[] = [
  diffToolStrategy,
  readToolStrategy,
  writeToolStrategy,
  executeToolStrategy,
  searchToolStrategy,
  goalToolStrategy,
  nodeReplToolStrategy,
  genericImageStrategy,
];

export function buildToolDisplayModel(
  toolCall: ChatToolCall,
  workspacePath: string,
): ToolDisplayModel {
  const preview = getToolCallCodePreview(toolCall, workspacePath);
  const contentPreview = getToolCallCodeContentPreview(toolCall, workspacePath);
  const errorText = getToolCallErrorText(toolCall);
  const identity = resolveToolCallIdentity(toolCall);
  const planResult = extractToolPlanResultFromValue(toolCall.output, workspacePath);
  const context: ToolDisplayContext = {
    toolCall,
    identity,
    preview,
    contentPreview,
    errorText,
  };

  const defaultModel: ToolDisplayModel = {
    inlinePreview: { type: "none" },
    planResult,
    viewerSource: preview,
    viewerLabelId: preview?.type === "patch" ? "codeViewer.viewDiff" : "codeViewer.viewCode",
    showSummaryFileLink: Boolean(preview?.path),
    showInput: planResult ? false : toolCall.input !== undefined,
    showOutput: toolCall.output !== undefined || Boolean(errorText),
    showKind: true,
  };

  const matchedStrategy = TOOL_DISPLAY_STRATEGIES.find((strategy) => strategy.matches(context));

  const model = matchedStrategy
    ? {
        ...defaultModel,
        ...matchedStrategy.build(context),
      }
    : defaultModel;

  if (planResult) {
    return {
      ...model,
      showInput: false,
      showOutput: Boolean(errorText),
    };
  }

  if (errorText) {
    return {
      ...model,
      inlinePreview: { type: "none" },
      showInput: false,
      showOutput: true,
      showKind: false,
    };
  }

  return model;
}
