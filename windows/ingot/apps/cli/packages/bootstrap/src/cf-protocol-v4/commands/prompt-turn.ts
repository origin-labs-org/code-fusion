import { OFF_PEAK_EXECUTION_TOOL_DENYLIST } from "@origin-ai/cf-shared";
//
import { type TurnBackgroundAttribution, type TurnInputIntentMetadata } from "@origin-ai/cf-contracts";
import type { TurnAttachment } from "@origin-ai/cf-core";
import type { CfAutomationBotDeliveryTarget } from "@origin-ai/cf-shared";
import type { SendInputOptions, SendInputResult } from "../../app/types.js";
import { runWithSessionResidencyFinalization } from "../../session-execution/index.js";
import type { V4CommandCoreHost, V4SessionRecordView } from "./types.js";

export interface StartPromptTurnParamsBase {
  content: string;
  
  inputId: string;
  inputPresentation?: SendInputOptions["inputPresentation"];
  
  attachments?: TurnAttachment[];
  browserAmbientContext?: SendInputOptions["browserAmbientContext"];
  intent?: TurnInputIntentMetadata;
  
  modelExecution?: SendInputOptions["modelExecution"];
  sharedContextRefs?: SendInputOptions["sharedContextRefs"];
  toolDisallowlist?: readonly string[];
  
  requireQueue?: boolean;
  
  requireIdle?: boolean;
  
  botDeliveryTarget?: CfAutomationBotDeliveryTarget;
}

export type StartPromptTurnParams = StartPromptTurnParamsBase & TurnBackgroundAttribution;

export interface PromptTurnStartResult {
  
  turnStarted: Promise<void>;
  
  completion?: Promise<unknown>;
  admission: SendInputResult;
  
  messageId?: string;
}

export class V4PromptRejectedError extends Error {
  readonly turnStartUncertain = false;

  constructor(
    readonly reasonCode: "restoreWarning" | "activePrompt" | "modelUnavailable",
    message: string,
  ) {
    super(message);
    this.name = "V4PromptRejectedError";
  }
}

export function isPromptTurnStartUncertainFailure(_error: unknown): boolean {
  return false;
}

export async function preflightPromptTurn(
  host: V4CommandCoreHost,
  record: V4SessionRecordView,
  params: StartPromptTurnParams,
): Promise<void> {
  const usesExecutionSelection =
    params.modelExecution?.selectionScope === "execution" && !params.requireQueue;
  if (!usesExecutionSelection && record.restoreWarning) {
    if (host.hasUsableRuntimeModelTarget?.(record) === true) {
      host.logger?.info?.("v4 restoreWarning cleared by model catalog recovery", {
        sessionId: record.app.sessionId,
        warningType: record.restoreWarning.type,
      });
      record.restoreWarning = undefined;
    }
  }
  if (!usesExecutionSelection && record.restoreWarning) {
    throw new V4PromptRejectedError("restoreWarning", record.restoreWarning.message);
  }
  if (!usesExecutionSelection) {
    await host.ensureModelReady?.(record);
  }
  const requestedSelection = params.intent?.modelSelection;
  const selectionFallback = params.modelExecution?.selectionFallback;
  const defersSelectionValidationToCore =
    usesExecutionSelection &&
    requestedSelection !== undefined &&
    selectionFallback !== undefined &&
    selectionFallback.providerId === requestedSelection.providerId;
  const availableModels =
    typeof record.app.listModels === "function" ? record.app.listModels() : undefined;
  const isSelectionAvailable = (selection: typeof requestedSelection): boolean =>
    selection !== undefined &&
    availableModels?.some(
      (model) =>
        model.ref.providerId === selection.providerId && model.ref.modelId === selection.modelId,
    ) === true;
  if (defersSelectionValidationToCore && availableModels) {
    const fallbackTarget = params.modelExecution?.selectionFallback?.target;
    if (!isSelectionAvailable(requestedSelection) && !isSelectionAvailable(fallbackTarget)) {
      const requestedLabel = requestedSelection
        ? `${requestedSelection.providerId}/${requestedSelection.modelId}`
        : "未声明";
      const fallbackLabel = fallbackTarget
        ? `${fallbackTarget.providerId}/${fallbackTarget.modelId}`
        : "未声明";
      throw new V4PromptRejectedError(
        "modelUnavailable",
        `Provider Registry Medium不存在execute Model (${requestedLabel}) orReturnedTarget Model (${fallbackLabel})`,
      );
    }
  }
  if (
    !defersSelectionValidationToCore &&
    requestedSelection &&
    availableModels &&
    !isSelectionAvailable(requestedSelection)
  ) {
    throw new V4PromptRejectedError(
      "modelUnavailable",
      `Model does not exist in Provider Registry: ${requestedSelection.providerId}/${requestedSelection.modelId}`,
    );
  }
}

export async function startPromptTurn(
  host: V4CommandCoreHost,
  record: V4SessionRecordView,
  params: StartPromptTurnParams,
): Promise<PromptTurnStartResult> {
  await preflightPromptTurn(host, record, params);
  return startPromptTurnAfterPreflight(host, record, params);
}

export async function startPreflightedPromptTurn(
  host: V4CommandCoreHost,
  record: V4SessionRecordView,
  params: StartPromptTurnParams,
): Promise<PromptTurnStartResult> {
  return startPromptTurnAfterPreflight(host, record, params);
}

async function startPromptTurnAfterPreflight(
  host: V4CommandCoreHost,
  record: V4SessionRecordView,
  params: StartPromptTurnParams,
): Promise<PromptTurnStartResult> {
  if (record.persistence === "deferred") record.persistence = "immediate";

  const previousAutomationId = record.activeAutomationId;
  const previousOffPeakTaskId = record.activeOffPeakTaskId;
  const previousBotDeliveryTarget = record.activeBotDeliveryTarget;
  const activeAutomationId = resolveTurnAutomationId(params);
  const activeOffPeakTaskId = resolveTurnOffPeakTaskId(params);
  const turnToolDisallowlist = buildTurnToolDisallowlist(
    params,
    activeAutomationId,
    activeOffPeakTaskId,
  );
  if (activeAutomationId) record.activeAutomationId = activeAutomationId;
  if (activeOffPeakTaskId) {
    record.activeOffPeakTaskId = activeOffPeakTaskId;
  }
  record.activeBotDeliveryTarget = params.botDeliveryTarget;

  let admission: SendInputResult;
  try {
    admission = await record.app.sendInput(
      {
        text: params.content,
        ...(params.attachments ? { attachments: params.attachments } : {}),
      },
      {
        delivery: "start_turn",
        ...(params.intent?.requestedDelivery === "guide"
          ? { queueDelivery: "guide" as const }
          : {}),
        ...(params.browserAmbientContext
          ? { browserAmbientContext: params.browserAmbientContext }
          : {}),
        inputId: params.inputId,
        ...(params.inputPresentation ? { inputPresentation: params.inputPresentation } : {}),
        ...turnBackgroundAttributionOf({
          automationId: activeAutomationId,
          offPeakTaskId: activeOffPeakTaskId,
          offPeakRunType: params.offPeakRunType,
        }),
        intent: params.intent,
        ...(params.modelExecution ? { modelExecution: params.modelExecution } : {}),
        ...(params.sharedContextRefs ? { sharedContextRefs: params.sharedContextRefs } : {}),
        ...(turnToolDisallowlist ? { toolDisallowlist: turnToolDisallowlist } : {}),
        ...(params.requireQueue ? { requireQueue: true } : {}),
        ...(params.requireIdle ? { requireIdle: true } : {}),
        queryId: params.inputId as SendInputOptions["queryId"],
      },
    );
  } catch (error) {
    clearPromptRecordState(
      record,
      previousAutomationId,
      previousOffPeakTaskId,
      previousBotDeliveryTarget,
    );
    await host.afterLegacyStateMutation?.(record, "prompt_failed");
    throw error;
  }

  if (admission.kind === "rejected") {
    clearPromptRecordState(
      record,
      previousAutomationId,
      previousOffPeakTaskId,
      previousBotDeliveryTarget,
    );
    throw new V4PromptRejectedError(
      "activePrompt",
      `Core prompt admission rejected: ${admission.reason}`,
    );
  }

  if (admission.kind === "queued") {
    clearPromptRecordState(
      record,
      previousAutomationId,
      previousOffPeakTaskId,
      previousBotDeliveryTarget,
    );
    return { admission, turnStarted: Promise.resolve() };
  }

  const completion = runWithSessionResidencyFinalization(record, async () => {
    let mutationReason = "prompt_completed";
    try {
      await admission.completion;
    } catch (error) {
      mutationReason = "prompt_failed";
      host.logger?.warn?.("v4 background turn failed", {
        error: error instanceof Error ? error.message : String(error),
        inputId: params.inputId,
        sessionId: record.app.sessionId,
      });
    } finally {
      clearPromptRecordState(
        record,
        previousAutomationId,
        previousOffPeakTaskId,
        previousBotDeliveryTarget,
      );
      await host.afterLegacyStateMutation?.(record, mutationReason);
    }
  });
  void completion.catch(() => undefined);
  host.logger?.info?.("v4 prompt admitted", {
    attachmentCount: params.attachments?.length ?? 0,
    inputId: params.inputId,
    sessionId: record.app.sessionId,
    textLength: params.content.length,
  });
  return { admission, completion, turnStarted: Promise.resolve() };
}

function clearPromptRecordState(
  record: V4SessionRecordView,
  previousAutomationId: string | undefined,
  previousOffPeakTaskId: string | undefined,
  previousBotDeliveryTarget: V4SessionRecordView["activeBotDeliveryTarget"],
): void {
  record.activeAutomationId = previousAutomationId;
  record.activeOffPeakTaskId = previousOffPeakTaskId;
  record.activeBotDeliveryTarget = previousBotDeliveryTarget;
}

export function buildTurnToolDisallowlist(
  params: Pick<StartPromptTurnParams, "automationId" | "offPeakTaskId" | "toolDisallowlist">,
  activeAutomationId = params.automationId,
  activeOffPeakTaskId = params.offPeakTaskId,
): readonly string[] | undefined {
  const tools = new Set(params.toolDisallowlist ?? []);
  if (activeAutomationId) {
    for (const toolName of AUTOMATION_MUTATION_TOOL_NAMES) tools.add(toolName);
  }
  if (activeOffPeakTaskId) {
    for (const toolName of OFF_PEAK_MUTATION_TOOL_NAMES) tools.add(toolName);
  }
  return tools.size > 0 ? [...tools] : undefined;
}

export function resolveTurnAutomationId(
  params: Pick<StartPromptTurnParams, "automationId" | "inputId">,
): string | undefined {
  const explicit = params.automationId?.trim();
  if (explicit) return explicit;
  const inputId = params.inputId.trim();
  if (!inputId.startsWith(AUTOMATION_INPUT_ID_PREFIX)) return undefined;
  const separatorIndex = inputId.indexOf(":");
  const automationId = separatorIndex >= 0 ? inputId.slice(0, separatorIndex) : inputId;
  return automationId.length > AUTOMATION_INPUT_ID_PREFIX.length ? automationId : undefined;
}

export function resolveTurnOffPeakTaskId(
  params: Pick<StartPromptTurnParams, "offPeakTaskId" | "inputId">,
): string | undefined {
  const explicit = params.offPeakTaskId?.trim();
  if (explicit) return explicit;
  const inputId = params.inputId.trim();
  if (!inputId.startsWith(OFF_PEAK_INPUT_ID_PREFIX)) return undefined;
  const separatorIndex = inputId.indexOf(":");
  const offPeakTaskId = separatorIndex >= 0 ? inputId.slice(0, separatorIndex) : inputId;
  return offPeakTaskId.length > OFF_PEAK_INPUT_ID_PREFIX.length ? offPeakTaskId : undefined;
}

export function turnBackgroundAttributionOf(params: {
  automationId?: string;
  offPeakTaskId?: string;
  offPeakRunType?: "init" | "resume";
}): TurnBackgroundAttribution {
  if (params.automationId) return { automationId: params.automationId };
  if (params.offPeakTaskId) {
    return {
      offPeakTaskId: params.offPeakTaskId,
      ...(params.offPeakRunType ? { offPeakRunType: params.offPeakRunType } : {}),
    };
  }
  return {};
}

const AUTOMATION_INPUT_ID_PREFIX = "automation-";
const AUTOMATION_MUTATION_TOOL_NAMES = ["CronCreate", "CronUpdate", "CronDelete"] as const;
const OFF_PEAK_INPUT_ID_PREFIX = "offpeak-";
const OFF_PEAK_MUTATION_TOOL_NAMES = OFF_PEAK_EXECUTION_TOOL_DENYLIST;
