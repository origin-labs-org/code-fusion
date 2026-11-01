import { useToolPresentationHostCapabilities } from "@/hooks/useToolPresentationHostCapabilities.js";
import { ToolPresentationCapabilitiesProvider } from "@/ToolCallBlocks/presentationCapabilities.js";
import { ToolCallBlock } from "@/ToolCallBlocks.js";
/* eslint-disable max-lines */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  OFFICIAL_CUA_PERMISSION_RULE_TOOL_NAME,
  WORKFLOW_REFINE_PERMISSION_OPTION_ID,
  type CfPermissionOption,
  type CfPermissionRequest,
  type CfProvider,
} from "@origin-ai/cf-shared";
import { MAX_PERMISSION_FEEDBACK_CHARS } from "@origin-ai/cf-shared/cf-protocol-v4";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { Textarea } from "@/components/ui/textarea.js";
import { isImeComposingKeyEvent } from "@/lib/imeComposition.js";
import {
  resolveMobileInputTextSizeClassName,
  shouldAvoidIosInputFocusZoom,
  useIsMobileTextInputViewport,
} from "@/lib/mobileTextInput.js";
import {
  getPermissionOptionDisplayKind,
  getPermissionRequestPreview,
  shouldPreferPermissionOptionName,
  sortPermissionOptions,
  type PermissionRequestScope,
} from "@/lib/permissionRequest.js";
import type { TaskChatToolCall } from "@/lib/taskChatMessageTypes.js";
import {
  readRawToolCallFileSummaries,
  type ToolCallBlockRenderContext,
} from "@/ToolCallBlocks/shared.js";
import { isPlainRecord, readRawToolCallInput } from "@/ToolCallBlocks/fileSummaryTypes.js";
import { ToolLayout } from "@/ToolCallBlocks/ToolLayout.js";
import { EditToolCallBlock } from "@/ToolCallBlocks/renderers/edit.js";
import { ExecuteToolCallBlock } from "@/ToolCallBlocks/renderers/execute.js";
import { FallbackToolCallBlock } from "@/ToolCallBlocks/renderers/fallback.js";
import { WebFetchToolCallBlock } from "@/ToolCallBlocks/renderers/web-fetch.js";
import { SearchToolCallBlock } from "@/ToolCallBlocks/renderers/search.js";
import { SkillToolCallBlock } from "@/ToolCallBlocks/renderers/skill.js";
import { resolveToolCallIdentity } from "@/lib/toolIdentity.js";
import { InteractionRequestOriginBadge } from "@/InteractionRequestOriginBadge.js";
import { WorkflowPermissionBlock } from "@/WorkflowPermissionBlock.js";
import {
  focusLastWorkflowSettingsControl,
  isWorkflowSettingsCarrier,
  usePermissionWorkflowSettings,
  workflowAdjustedOptionDescriptionId,
} from "@/permissionWorkflowSettings.js";
import { SaveWorkflowPermissionBlock } from "@/SaveWorkflowPermissionBlock.js";
import { isSaveWorkflowToolCall } from "@/lib/workflowToolNames.js";
import { useCfStoreWithDefault } from "@/store/StoreProvider.js";
import { DEFAULT_CODE_PREVIEW_SETTINGS } from "@/lib/codePreviewSettings.js";
import { useCfIntl } from "./i18n/IntlProvider.js";
import { Info, LoaderIcon, WrenchIcon } from "lucide-react";

const MCP_PERMISSION_TOOL_ICON = <WrenchIcon className="size-4 shrink-0 text-foreground-subtle" />;

type PermissionBlockKind =
  | "edit"
  | "execute"
  | "mcp"
  | "web-fetch"
  | "search"
  | "skill"
  | "workflow"
  | "saveWorkflow"
  | "fallback";

interface PermissionBlockInteraction {
  canToggle: boolean;
  forceOpen: boolean;
}

interface PermissionRuleScope {
  display: string;
  truncated: boolean;
}

const PERMISSION_RULE_SCOPE_MAX_DISPLAY_CHARS = 160;
const NON_USER_FACING_PERMISSION_REASONS = new Set([
  "High risk tools require explicit approval",
  "Tool has side effects and requires approval",
]);

function formatPermissionRuleScope(content: string): PermissionRuleScope {
  const lineBreakIndex = content.search(/\r?\n/);
  const firstLine = lineBreakIndex === -1 ? content : content.slice(0, lineBreakIndex);
  const truncated =
    lineBreakIndex !== -1 || firstLine.length > PERMISSION_RULE_SCOPE_MAX_DISPLAY_CHARS;

  const suffix = " …";
  const visible = firstLine
    .slice(0, PERMISSION_RULE_SCOPE_MAX_DISPLAY_CHARS - suffix.length)
    .trimEnd();
  return { display: `${visible}${suffix}`, truncated };
}

function readPermissionRuleScopes(option: CfPermissionOption): PermissionRuleScope[] {
  const scopes: PermissionRuleScope[] = [];
  for (const update of option.response?.permissionUpdates ?? []) {
    if (update.type !== "addRules" || update.behavior !== "allow") continue;
    for (const rule of update.rules) {
      if (rule.toolName.toLowerCase() !== "bash") continue;
      const content = rule.ruleContent?.trim();
      if (!content?.endsWith(":*")) continue;
      scopes.push(formatPermissionRuleScope(content.slice(0, -2)));
    }
  }
  return scopes.slice(0, 5);
}

function isOfficialCuaProjectPermission(option: CfPermissionOption): boolean {
  return (option.response?.permissionUpdates ?? []).some(
    (update) =>
      update.type === "addRules" &&
      update.behavior === "allow" &&
      update.rules.some((rule) => rule.toolName === OFFICIAL_CUA_PERMISSION_RULE_TOOL_NAME),
  );
}

function isWorkflowRefineOption(option: CfPermissionOption): boolean {
  return option.optionId === WORKFLOW_REFINE_PERMISSION_OPTION_ID;
}

function InlinePermissionPrefixScopes({ scopes }: { scopes: readonly PermissionRuleScope[] }) {
  if (scopes.length === 0) return null;
  return (
    <span
      className="flex min-w-0 flex-1 basis-48 flex-col gap-1"
      data-permission-rule-scopes="true"
      data-permission-rule-prefixes="true"
    >
      {scopes.map((scope, index) => (
        <code
          key={`${scope.display}:${index}`}
          className="min-w-0 whitespace-pre-wrap break-all font-mono text-ui-base leading-5 text-foreground-subtle"
          data-permission-rule-scope="prefix"
          data-permission-rule-scope-truncated={scope.truncated ? "true" : undefined}
        >
          {scope.display}
        </code>
      ))}
    </span>
  );
}

function getOptionLabelMessageId(kind: string): string | null {
  switch (getPermissionOptionDisplayKind(kind)) {
    case "allowOnce":
      return "chat.permission.approve";
    case "allowAlways":
      return "chat.permission.approveAlways";
    case "rejectOnce":
      return "chat.permission.deny";
    case "rejectAlways":
      return "chat.permission.denyAlways";
    default:
      return null;
  }
}

const PROVIDER_PERMISSION_OPTION_NAME_LABELS: Partial<
  Record<CfProvider, Record<string, string>>
> = {
  glm: {
    "always allow in this project": "chat.permission.allowForProject",
  },
};

interface PermissionOptionNameMessageIds {
  label: string;
  
  description?: string;
}

const GLOBAL_PERMISSION_OPTION_NAME_LABELS: Record<string, PermissionOptionNameMessageIds> = {
  "full access": {
    label: "chat.permission.fullAccess",
    description: "chat.permission.fullAccess.description",
  },
  "always allow in this project": { label: "chat.permission.allowForProject" },
  "always allow computer use in this project": { label: "chat.permission.cua.allowForProject" },
  "always allow in this session": {
    label: "chat.permission.workflow.allowForSession",
    description: "chat.permission.workflow.allowForSession.description",
  },
};

function getProviderOptionNameMessageIds(
  provider: CfProvider | undefined,
  name: string,
): PermissionOptionNameMessageIds | null {
  const normalizedName = name.trim().replace(/\s+/g, " ").toLowerCase();
  const global = GLOBAL_PERMISSION_OPTION_NAME_LABELS[normalizedName];
  if (global) {
    return global;
  }
  const providerLabel = provider
    ? PROVIDER_PERMISSION_OPTION_NAME_LABELS[provider]?.[normalizedName]
    : undefined;
  return providerLabel ? { label: providerLabel } : null;
}

function getOptionDescriptionMessageId(kind: string, scope: PermissionRequestScope): string | null {
  switch (getPermissionOptionDisplayKind(kind)) {
    case "allowOnce":
      return "chat.permission.allowOnce.description";
    case "allowAlways":
      return `chat.permission.allowAlways.description.${scope}`;
    case "rejectOnce":
      return "chat.permission.denyOnce.description";
    case "rejectAlways":
      return `chat.permission.denyAlways.description.${scope}`;
    default:
      return null;
  }
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readUserFacingPermissionReason(value: unknown): string | null {
  const reason = readNonEmptyString(value);
  return reason && !NON_USER_FACING_PERMISSION_REASONS.has(reason) ? reason : null;
}

function getPermissionDisplayReason(request: CfPermissionRequest): string | null {
  const rawInput = readRawToolCallInput(request.raw);
  const inputReason = isPlainRecord(rawInput)
    ? (readUserFacingPermissionReason(rawInput.description) ??
      readUserFacingPermissionReason(rawInput.reason) ??
      readUserFacingPermissionReason(rawInput.summary))
    : null;
  const rawReason = isPlainRecord(request.raw)
    ? readUserFacingPermissionReason(request.raw.reason)
    : null;

  return inputReason ?? readUserFacingPermissionReason(request.description) ?? rawReason;
}

function getMcpPermissionToolName(toolCall: TaskChatToolCall): string | null {
  const rawToolName = isPlainRecord(toolCall.raw)
    ? (readNonEmptyString(toolCall.raw.toolName) ?? readNonEmptyString(toolCall.raw.tool_name))
    : null;
  const toolName =
    readNonEmptyString(toolCall.toolName) ??
    rawToolName ??
    readNonEmptyString(toolCall.kind) ??
    readNonEmptyString(toolCall.title);

  return toolName?.startsWith("mcp__") ? toolName : null;
}

function getMcpPermissionReason(toolCall: TaskChatToolCall): string | null {
  return isPlainRecord(toolCall.raw) ? readNonEmptyString(toolCall.raw.reason) : null;
}

function resolvePermissionBlockKind(
  preview: ReturnType<typeof getPermissionRequestPreview>,
  toolCall: TaskChatToolCall,
  rawFileSummaries: ToolCallBlockRenderContext["rawFileSummaries"],
): PermissionBlockKind {
  if (isSaveWorkflowToolCall(toolCall)) {
    return "saveWorkflow";
  }

  if (rawFileSummaries.length > 0 || preview.fileChanges.length > 0) {
    return "edit";
  }

  const identity = resolveToolCallIdentity(toolCall);

  if (getMcpPermissionToolName(toolCall)) {
    return "mcp";
  }

  if (identity.family === "skill") {
    return "skill";
  }

  if (identity.family === "workflow") {
    return "workflow";
  }

  if (identity.family === "web-fetch") return "web-fetch";
  if (identity.family === "search") {
    return "search";
  }

  if (preview.command) {
    return "execute";
  }

  return "fallback";
}

function getPermissionBlockInteraction(blockKind: PermissionBlockKind): PermissionBlockInteraction {
  switch (blockKind) {
    case "edit":
      return {
        canToggle: false,
        forceOpen: false,
      };
    case "mcp":
    case "skill":
    case "web-fetch":
    case "search":
    case "execute":
    case "workflow":
    case "saveWorkflow":
    case "fallback":
      return {
        canToggle: false,
        forceOpen: true,
      };
  }
}

function buildPermissionToolCall(
  request: CfPermissionRequest,
  preview: ReturnType<typeof getPermissionRequestPreview>,
): TaskChatToolCall {
  const rawInput = readRawToolCallInput(request.raw);

  return {
    toolId: `permission:${request.requestId}`,
    kind: request.kind,
    title: request.title ?? request.description ?? preview.title,
    input: rawInput ?? preview.command ?? request.raw,
    status: "completed",
    raw: request.raw,
  };
}

function buildPermissionBlockContext(
  toolCall: TaskChatToolCall,
  rawFileSummaries: ToolCallBlockRenderContext["rawFileSummaries"],
  workspacePath: string,
  blockKind: PermissionBlockKind,
  kindLabelOverride: ReactNode,
  theme: ToolCallBlockRenderContext["theme"],
  codePreviewSettings: ToolCallBlockRenderContext["codePreviewSettings"],
): ToolCallBlockRenderContext {
  const { canToggle, forceOpen } = getPermissionBlockInteraction(blockKind);

  return {
    nestedToolRenderer: ToolCallBlock,
    toolCallNode: {
      toolCall,
      childToolCalls: [],
    } as ToolCallBlockRenderContext["toolCallNode"],
    workspacePath,
    theme,
    codePreviewSettings,
    displayModel: {
      inlinePreview: { type: "none" },
      planResult: null,
      viewerSource: null,
      viewerLabelId: "codeViewer.viewCode",
      showSummaryFileLink: false,
      showInput: false,
      showOutput: false,
      showKind: false,
    },
    viewerSource: null,
    rawFileSummaries,
    isRunning: false,
    isPermissionPreview: true,
    statusLabel: "",
    childToolList: null,
    showIcon: true,
    kindLabelOverride,
    canToggle,
    forceOpen,
    onOpenCodeViewer: undefined,
    onOpenBrowserUrl: undefined,
  };
}

function McpPermissionBlock(context: ToolCallBlockRenderContext) {
  const { toolCall } = context.toolCallNode;
  const toolName = getMcpPermissionToolName(toolCall) ?? toolCall.title ?? toolCall.kind;
  const reason = getMcpPermissionReason(toolCall);
  const hasKindLabelOverride = context.kindLabelOverride != null;
  const primaryText = useMemo(
    () =>
      hasKindLabelOverride ? (
        <span className="min-w-0 truncate text-foreground-subtle">{toolName}</span>
      ) : reason ? (
        <span className="min-w-0 truncate text-foreground-subtle">{reason}</span>
      ) : null,
    [hasKindLabelOverride, reason, toolName],
  );

  return (
    <ToolLayout
      toolId={toolCall.toolId}
      icon={MCP_PERMISSION_TOOL_ICON}
      showIcon={context.showIcon !== false}
      canToggle={false}
      kindLabel={context.kindLabelOverride ?? toolName}
      primaryText={primaryText}
      isRunning={context.isRunning}
      content={null}
    />
  );
}

function focusLastSaveWorkflowControl(root: HTMLElement | null): boolean {
  const controls = root?.querySelectorAll<HTMLElement>(
    "[data-permission-dialog-scroll] button:not([disabled])",
  );
  const last = controls === undefined ? undefined : controls[controls.length - 1];
  if (last === undefined) return false;
  last.focus();
  return true;
}

export function PermissionDialog({
  request,
  onRespond,
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  workflowSessionModel,
  provider,
  isWebRemoteControl = false,
  responding = false,
  responseError,
}: {
  request: CfPermissionRequest;
  responding?: boolean;
  responseError?: string;
  
  onRespond: (
    requestId: string,
    option: CfPermissionOption,
    feedback?: string,
    content?: Record<string, unknown>,
  ) => void;
  workspacePath: string;
  
  workspaceIdentity?: string;
  remoteSessionId?: string;
  workflowSessionModel?: { providerId: string; modelId: string };
  provider?: CfProvider;
  isWebRemoteControl?: boolean;
}) {
  const { intl } = useCfIntl();
  const presentationCapabilities = useToolPresentationHostCapabilities(workspacePath);
  const isMobileTextInputViewport = useIsMobileTextInputViewport();
  const avoidIosInputFocusZoom = shouldAvoidIosInputFocusZoom({
    isMobileTextInputViewport,
    isWebRemoteControl,
  });
  const theme = useCfStoreWithDefault((state) => state.theme, "system");
  const codePreviewSettings = useCfStoreWithDefault(
    (state) => state.codePreviewSettings,
    DEFAULT_CODE_PREVIEW_SETTINGS,
  );
  const refineOption = useMemo(
    () => request.options.find(isWorkflowRefineOption),
    [request.options],
  );
  const orderedOptions = useMemo(
    () =>
      sortPermissionOptions(request.options).filter((option) => !isWorkflowRefineOption(option)),
    [request.options],
  );
  const preview = useMemo(() => getPermissionRequestPreview(request), [request]);
  const toolCall = useMemo(() => buildPermissionToolCall(request, preview), [preview, request]);
  const rawFileSummaries = useMemo(
    () =>
      readRawToolCallFileSummaries(toolCall.raw, {
        kind: toolCall.kind,
        title: toolCall.title,
        input: toolCall.input,
        output: toolCall.output,
        raw: toolCall.raw,
      }),
    [toolCall],
  );
  const blockKind = useMemo(
    () => resolvePermissionBlockKind(preview, toolCall, rawFileSummaries),
    [preview, rawFileSummaries, toolCall],
  );
  const blockContext = useMemo(
    () =>
      buildPermissionBlockContext(
        toolCall,
        rawFileSummaries,
        workspacePath,
        blockKind,
        intl.formatMessage({ id: "chat.permission.awaitingApproval" }),
        theme,
        codePreviewSettings,
      ),
    [blockKind, codePreviewSettings, intl, rawFileSummaries, theme, toolCall, workspacePath],
  );
  const displayReason = useMemo(() => getPermissionDisplayReason(request), [request]);
  const isWorkflowAsk = blockKind === "workflow";
  const workflowSettings = usePermissionWorkflowSettings(request.requestId);
  const workflowSettingsContent = isWorkflowAsk ? workflowSettings.content : undefined;
  const isOptionBlocked = useCallback(
    (option: CfPermissionOption) =>
      isWorkflowAsk && workflowSettings.blocked && isWorkflowSettingsCarrier(option),
    [isWorkflowAsk, workflowSettings.blocked],
  );
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [feedback, setFeedback] = useState("");
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const feedbackInputRef = useRef<HTMLTextAreaElement | null>(null);
  const feedbackCompositionActiveRef = useRef(false);
  const feedbackInputFocusedRef = useRef(false);
  const denyOption = useMemo(
    () =>
      orderedOptions.find((option) =>
        getPermissionOptionDisplayKind(option.kind).startsWith("reject"),
      ),
    [orderedOptions],
  );
  const feedbackOption = refineOption ?? (request.freeText === true ? denyOption : undefined);
  const hasFeedbackInput = Boolean(feedbackOption);
  const feedbackIndex = orderedOptions.length;
  const selectableCount = orderedOptions.length + (hasFeedbackInput ? 1 : 0);
  const isFeedbackSelected = hasFeedbackInput && selectedIndex === feedbackIndex;

  useEffect(() => {
    setSelectedIndex(0);
    setFeedback("");
  }, [request.requestId]);

  useEffect(() => {
    if (orderedOptions.length === 0) {
      return;
    }
    if (feedbackInputFocusedRef.current) {
      return;
    }

    const frameId = requestAnimationFrame(() => {
      if (!feedbackInputFocusedRef.current) {
        if (isFeedbackSelected) feedbackInputRef.current?.focus();
        else optionRefs.current[selectedIndex]?.focus();
      }
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [isFeedbackSelected, orderedOptions.length, request.requestId, selectedIndex]);

  const moveSelection = useCallback(
    (direction: 1 | -1) => {
      if (selectableCount === 0) {
        return;
      }

      feedbackInputFocusedRef.current = false;
      setSelectedIndex(
        (currentIndex) => (currentIndex + direction + selectableCount) % selectableCount,
      );
    },
    [selectableCount],
  );

  const respondWithOption = useCallback(
    (option: CfPermissionOption) => {
      if (responding || isOptionBlocked(option)) return;
      const selectedKind = getPermissionOptionDisplayKind(option.kind);
      const trimmedFeedback =
        !refineOption && selectedKind.startsWith("reject") ? feedback.trim() : "";
      const content =
        workflowSettingsContent !== undefined && isWorkflowSettingsCarrier(option)
          ? { ...workflowSettingsContent }
          : undefined;
      if (content === undefined) {
        onRespond(request.requestId, option, trimmedFeedback || undefined);
      } else {
        onRespond(request.requestId, option, trimmedFeedback || undefined, content);
      }
    },
    [
      feedback,
      isOptionBlocked,
      onRespond,
      refineOption,
      request.requestId,
      responding,
      workflowSettingsContent,
    ],
  );

  const submitFeedback = useCallback(() => {
    const trimmedFeedback = feedback.trim();
    if (responding || !feedbackOption || !trimmedFeedback) {
      return;
    }
    onRespond(request.requestId, feedbackOption, trimmedFeedback);
  }, [feedback, feedbackOption, onRespond, request.requestId, responding]);

  const confirmSelection = useCallback(() => {
    if (isFeedbackSelected) {
      submitFeedback();
      return;
    }
    const selectedOption = orderedOptions[selectedIndex];
    if (selectedOption) respondWithOption(selectedOption);
  }, [isFeedbackSelected, orderedOptions, respondWithOption, selectedIndex, submitFeedback]);

  const handleFeedbackKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      event.stopPropagation();
      if (
        isImeComposingKeyEvent({
          compositionActive: feedbackCompositionActiveRef.current,
          nativeEvent: event.nativeEvent,
        })
      ) {
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Tab") {
        event.preventDefault();
        moveSelection(event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey) ? -1 : 1);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        submitFeedback();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        feedbackInputRef.current?.blur();
      }
    },
    [moveSelection, submitFeedback],
  );

  const handleOptionKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (hasFeedbackInput && event.key === String(feedbackIndex + 1)) {
        event.preventDefault();
        setSelectedIndex(feedbackIndex);
        return;
      }
      if (event.key === "1" || event.key === "2" || event.key === "3") {
        const shortcutIndex = Number(event.key) - 1;
        const shortcutOption = orderedOptions[shortcutIndex];
        if (!shortcutOption) {
          return;
        }

        event.preventDefault();
        setSelectedIndex(shortcutIndex);
        respondWithOption(shortcutOption);
        return;
      }

      switch (event.key) {
        case "ArrowUp":
        case "ArrowLeft":
          event.preventDefault();
          moveSelection(-1);
          return;
        case "ArrowDown":
        case "ArrowRight":
          event.preventDefault();
          moveSelection(1);
          return;
        case "Tab":
          if (
            event.shiftKey &&
            optionRefs.current.indexOf(event.currentTarget) === 0 &&
            rootRef.current?.querySelector("[data-command-preview-toggle]")
          ) {
            return;
          }
          if (
            event.shiftKey &&
            optionRefs.current.indexOf(event.currentTarget) === 0 &&
            isWorkflowAsk &&
            focusLastWorkflowSettingsControl(rootRef.current)
          ) {
            event.preventDefault();
            return;
          }
          if (
            event.shiftKey &&
            optionRefs.current.indexOf(event.currentTarget) === 0 &&
            blockKind === "saveWorkflow" &&
            focusLastSaveWorkflowControl(rootRef.current)
          ) {
            event.preventDefault();
            return;
          }
          event.preventDefault();
          moveSelection(event.shiftKey ? -1 : 1);
          return;
        case "Enter":
          event.preventDefault();
          confirmSelection();
          return;
        default:
          return;
      }
    },
    [
      blockKind,
      confirmSelection,
      feedbackIndex,
      hasFeedbackInput,
      isWorkflowAsk,
      moveSelection,
      orderedOptions,
      respondWithOption,
    ],
  );

  const PermissionBlock =
    blockKind === "edit"
      ? EditToolCallBlock
      : blockKind === "mcp"
        ? McpPermissionBlock
        : blockKind === "skill"
          ? SkillToolCallBlock
          : blockKind === "web-fetch"
            ? WebFetchToolCallBlock
            : blockKind === "search"
              ? SearchToolCallBlock
              : blockKind === "execute"
                ? ExecuteToolCallBlock
                : FallbackToolCallBlock;
  const shouldUseSwitchModePlaceholder = resolveToolCallIdentity(toolCall).family === "switch-mode";
  const shouldUseWorkflowBlock = isWorkflowAsk;
  const shouldUseSaveWorkflowBlock = blockKind === "saveWorkflow";
  const bounded = shouldUseSaveWorkflowBlock;
  return (
    <div ref={rootRef} className="w-full shrink-0 relative z-1">
      <div
        className={cn(
          "w-full rounded-2xl border border-border bg-popover shadow-xs",
          bounded
            ? "max-h-[min(72dvh,42rem)] overflow-y-auto overscroll-contain [@media(min-height:36rem)]:flex [@media(min-height:36rem)]:flex-col [@media(min-height:36rem)]:overflow-hidden"
            : "overflow-hidden",
        )}
        {...(bounded ? { "data-permission-dialog-bounded": "true" } : {})}
      >
        <div
          className={cn(
            "flex flex-col gap-3 p-3",
            bounded && "[@media(min-height:36rem)]:min-h-0 [@media(min-height:36rem)]:flex-1",
          )}
        >
          <div
            className={cn(
              "space-y-4",
              bounded &&
                "-mx-3 -mt-3 border-b border-border p-3 [@media(min-height:36rem)]:min-h-0 [@media(min-height:36rem)]:overflow-y-auto [@media(min-height:36rem)]:overscroll-contain",
            )}
            {...(bounded ? { "data-permission-dialog-scroll": "true" } : {})}
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-ui-base font-medium leading-tight text-foreground-subtle">
                {intl.formatMessage({ id: "chat.permission.title" })}
              </p>
              <InteractionRequestOriginBadge origin={request.origin} />
            </div>
            {!shouldUseSwitchModePlaceholder &&
            !shouldUseWorkflowBlock &&
            !shouldUseSaveWorkflowBlock &&
            displayReason ? (
              <p className="text-ui-base leading-5 text-foreground">{displayReason}</p>
            ) : null}
            {shouldUseSwitchModePlaceholder ? (
              <div className="flex items-center gap-2 text-ui-base text-foreground">
                <LoaderIcon className="size-4 shrink-0 animate-spin text-foreground-subtle" />
                <span className="animated-gradient-text font-medium">
                  {intl.formatMessage({
                    id: "chat.permission.switchMode.placeholder",
                  })}
                </span>
              </div>
            ) : shouldUseWorkflowBlock ? (
              <WorkflowPermissionBlock
                onSettingsBlockedChange={workflowSettings.onBlockedChange}
                onSettingsChange={workflowSettings.onContentChange}
                request={request}
                settingsDisabled={responding}
                workspacePath={workspacePath}
                {...(workspaceIdentity === undefined ? {} : { workspaceIdentity })}
                {...(remoteSessionId === undefined ? {} : { remoteSessionId })}
                {...(workflowSessionModel === undefined
                  ? {}
                  : { sessionModel: workflowSessionModel })}
              />
            ) : shouldUseSaveWorkflowBlock ? (
              <SaveWorkflowPermissionBlock request={request} />
            ) : (
              <ToolPresentationCapabilitiesProvider value={presentationCapabilities}>
                <PermissionBlock {...blockContext} />
              </ToolPresentationCapabilitiesProvider>
            )}
          </div>

          {}
          <div className="shrink-0 space-y-1">
            <div
              role="listbox"
              aria-label={intl.formatMessage({ id: "chat.permission.title" })}
              className="space-y-1"
            >
              {orderedOptions.map((option, index) => {
                const isSelected = index === selectedIndex;
                const officialCuaProjectPermission = isOfficialCuaProjectPermission(option);
                const labelMessageId = officialCuaProjectPermission
                  ? "chat.permission.cua.allowForProject"
                  : option.name.trim().toLowerCase() === "always allow in this project" &&
                      preview.scope === "command"
                    ? "chat.permission.allowCommand"
                    : getOptionLabelMessageId(option.kind);
                const nameMessageIds = getProviderOptionNameMessageIds(provider, option.name);
                const baseDescriptionMessageId = officialCuaProjectPermission
                  ? "chat.permission.cua.allowForProject.description"
                  : labelMessageId === "chat.permission.allowCommand"
                    ? "chat.permission.allowCommand.description"
                    : (nameMessageIds?.description ??
                      getOptionDescriptionMessageId(option.kind, preview.scope));
                // 「The options」）。
                const descriptionMessageId =
                  workflowSettingsContent === undefined
                    ? baseDescriptionMessageId
                    : workflowAdjustedOptionDescriptionId(baseDescriptionMessageId);
                const blocked = isOptionBlocked(option);
                const fallbackLabel = labelMessageId
                  ? intl.formatMessage({ id: labelMessageId })
                  : null;
                const knownNameLabel = nameMessageIds
                  ? intl.formatMessage({ id: nameMessageIds.label })
                  : null;
                const preferOptionName = shouldPreferPermissionOptionName(option);
                const label =
                  (labelMessageId === "chat.permission.allowCommand"
                    ? fallbackLabel
                    : knownNameLabel) ??
                  (preferOptionName ? option.name : (fallbackLabel ?? option.name));
                const description =
                  (preferOptionName && !knownNameLabel) || !descriptionMessageId
                    ? null
                    : intl.formatMessage({ id: descriptionMessageId });
                const ruleScopes =
                  getPermissionOptionDisplayKind(option.kind) === "allowAlways"
                    ? readPermissionRuleScopes(option)
                    : [];

                return (
                  <button
                    key={option.optionId}
                    data-permission-option-kind={getPermissionOptionDisplayKind(option.kind)}
                    ref={(node) => {
                      optionRefs.current[index] = node;
                    }}
                    type="button"
                    role="option"
                    aria-label={label}
                    aria-selected={isSelected}
                    {...(blocked ? { "aria-disabled": true } : {})}
                    tabIndex={isSelected ? 0 : -1}
                    onClick={() => {
                      if (isSelected) {
                        respondWithOption(option);
                      } else {
                        setSelectedIndex(index);
                      }
                    }}
                    onFocus={() => setSelectedIndex(index)}
                    onKeyDown={handleOptionKeyDown}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left outline-none transition-colors focus-visible:bg-selected",
                      isSelected ? "bg-selected" : "hover:bg-hover",
                      blocked && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <span
                      className={cn(
                        "w-5 shrink-0 text-ui-base font-medium self-center",
                        isSelected ? "text-foreground" : "text-foreground-subtlest",
                      )}
                    >
                      {index + 1}.
                    </span>
                    <span className="min-w-0 flex flex-1 flex-col">
                      <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-ui-base font-medium text-foreground">{label}</span>
                        {ruleScopes.length > 0 ? (
                          <InlinePermissionPrefixScopes scopes={ruleScopes} />
                        ) : description ? (
                          <span className="text-ui-base leading-4 text-foreground-subtle">
                            {description}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {feedbackOption ? (
              <div
                onClick={(event) => {
                  if (event.target !== feedbackInputRef.current) {
                    feedbackInputRef.current?.focus();
                  }
                }}
                className={cn(
                  "flex w-full cursor-text items-center gap-3 rounded-xl px-3 py-2 transition-colors",
                  isFeedbackSelected ? "bg-selected" : "hover:bg-hover",
                )}
              >
                <span
                  className={cn(
                    "mt-px w-5 shrink-0 self-start text-ui-base font-medium md:leading-relaxed",
                    avoidIosInputFocusZoom ? "leading-6" : "leading-5",
                    isFeedbackSelected ? "text-foreground" : "text-foreground-subtlest",
                  )}
                >
                  {feedbackIndex + 1}.
                </span>
                <Textarea
                  ref={feedbackInputRef}
                  rows={1}
                  wrap="soft"
                  value={feedback}
                  maxLength={MAX_PERMISSION_FEEDBACK_CHARS}
                  aria-label={intl.formatMessage({
                    id: refineOption
                      ? "chat.permission.workflow.refine"
                      : "chat.permission.feedback.ariaLabel",
                  })}
                  placeholder={intl.formatMessage({
                    id: refineOption
                      ? "chat.permission.workflow.refine.placeholder"
                      : "chat.permission.feedback.placeholder",
                  })}
                  data-permission-feedback-option={feedbackOption.optionId}
                  onFocus={() => {
                    feedbackInputFocusedRef.current = true;
                    setSelectedIndex(feedbackIndex);
                  }}
                  onBlur={() => {
                    feedbackInputFocusedRef.current = false;
                  }}
                  onChange={(event) => {
                    setFeedback(event.target.value);
                  }}
                  onCompositionStart={() => {
                    feedbackCompositionActiveRef.current = true;
                  }}
                  onCompositionEnd={() => {
                    feedbackCompositionActiveRef.current = false;
                  }}
                  onKeyDown={handleFeedbackKeyDown}
                  className={cn(
                    "h-auto !min-h-5 max-h-[5lh] min-w-0 max-w-full overflow-y-auto rounded-none border-transparent bg-transparent !px-0 !py-0 font-medium shadow-none hover:border-transparent focus-visible:border-transparent focus-visible:bg-transparent focus-visible:ring-0",
                    resolveMobileInputTextSizeClassName({ avoidIosInputFocusZoom }),
                  )}
                />
              </div>
            ) : null}
          </div>

          {responseError ? (
            <p role="alert" className="shrink-0 text-ui-base text-destructive">
              {responseError}
            </p>
          ) : null}
          <div className="flex shrink-0 items-center justify-between gap-2 px-1">
            <p className="flex gap-2 text-ui-base items-center text-foreground-subtle">
              <Info className="text-foreground size-4 shrink-0" />
              {intl.formatMessage({ id: "chat.permission.keyboardHint" })}
            </p>
            <Button
              type="button"
              aria-label={intl.formatMessage({ id: "common.confirm" })}
              size="lg"
              onClick={confirmSelection}
              disabled={
                responding ||
                (isFeedbackSelected
                  ? !feedback.trim()
                  : orderedOptions[selectedIndex] === undefined ||
                    isOptionBlocked(orderedOptions[selectedIndex]))
              }
              className="bg-brand text-foreground-inverse hover:bg-brand/80"
            >
              {intl.formatMessage({ id: "common.confirm" })}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
