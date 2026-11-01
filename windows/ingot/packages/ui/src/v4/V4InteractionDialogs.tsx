import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CfElicitationRequest, CfPermissionOption, CfProvider } from "@origin-ai/cf-shared";
import type { ConversationSnapshot } from "@origin-ai/cf-shared/cf-protocol-v4";
import { ElicitationDialog } from "@/ElicitationDialog.js";
import { PermissionDialog } from "@/PermissionDialog.js";
import { workflowSessionModelOf } from "@/components/workflow-timeline/workflowRunSettings.js";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { usePendingInteractionTaskNotifications } from "@/hooks/useTaskNotifications.js";
import { logger } from "@/logger.js";
import { useCfStoreWithDefault } from "@/store/StoreProvider.js";
import { useWorkspaceHookReviewStore } from "@/store/workspaceHookReviewStore.js";
import {
  getTaskUiState,
  getWorkspaceState,
  useCfSessionStore,
} from "@/store/cfSessionStore.js";
import type { ElicitationFormDraft } from "@/store/cfSessionStoreTypes.js";
import { createCommandEnvelope } from "@/v4/commandFactory.js";
import { pendingCommandRegistry } from "@/v4/pendingCommandRegistry.js";
import { sendInteractionAutoResolutionSnooze } from "@/v4/interactionAutoResolutionCommand.js";
import {
  pendingPermissionToLegacyRequest,
  pendingUserInputToElicitationRequest,
  pendingUserInputToViewModel,
} from "@/v4/pendingInteractionAdapter.js";
import { V4UserInputDialog } from "@/v4/V4UserInputDialog.js";
import { useV4Conversation } from "@/v4/V4ConversationContext.js";

export interface V4InteractionDialogsProps {
  sessionId: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  isWebRemoteControl?: boolean;
  provider?: CfProvider;
  snapshot: ConversationSnapshot | null;
  onCommandSettled?: (commandId: string) => void;
  onPlanInteractionAccepted?: (interactionId: string) => void;
}

export function getCurrentSessionInteractionSnapshot(
  sessionId: string,
  snapshot: ConversationSnapshot | null,
): ConversationSnapshot | null {
  return snapshot?.sessionId === sessionId ? snapshot : null;
}

export function resolveV4ElicitationRequest(
  projected: CfElicitationRequest | null,
  botProgress: CfElicitationRequest | null,
): CfElicitationRequest | null {
  if (projected && botProgress?.requestId === projected.requestId) {
    return botProgress;
  }
  return projected;
}

export function buildV4ElicitationProgressKey(request: CfElicitationRequest): string {
  return `${request.requestId}:${request.currentQuestionIndex ?? 0}:${JSON.stringify(request.answerDrafts ?? {})}`;
}

export interface InteractionAutoResolutionIntentTracker {
  markInteracted(interactionId: string): void;
  consumeSnooze(interactionId: string, autoResolutionReady: boolean): boolean;
  releaseSnooze(interactionId: string): void;
}

export function createInteractionAutoResolutionIntentTracker(): InteractionAutoResolutionIntentTracker {
  const interactedIds = new Set<string>();
  const sentIds = new Set<string>();
  return {
    markInteracted(interactionId) {
      interactedIds.add(interactionId);
    },
    consumeSnooze(interactionId, autoResolutionReady) {
      if (!autoResolutionReady || !interactedIds.has(interactionId) || sentIds.has(interactionId)) {
        return false;
      }
      sentIds.add(interactionId);
      return true;
    },
    releaseSnooze(interactionId) {
      sentIds.delete(interactionId);
    },
  };
}

export function V4InteractionDialogs({
  sessionId,
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  isWebRemoteControl = false,
  provider,
  snapshot,
  onCommandSettled,
  onPlanInteractionAccepted,
}: V4InteractionDialogsProps) {
  const { sendCommand } = useV4Conversation();
  const connectWorkspaceHookCommands = useWorkspaceHookReviewStore((state) => state.connect);
  const disconnectWorkspaceHookCommands = useWorkspaceHookReviewStore((state) => state.disconnect);
  const upsertWorkspaceHookReview = useWorkspaceHookReviewStore((state) => state.upsert);
  const clearWorkspaceHookReview = useWorkspaceHookReviewStore((state) => state.clear);
  const platform = useOptionalPlatform();
  const { intl } = useCfIntl();
  const currentSnapshot = getCurrentSessionInteractionSnapshot(sessionId, snapshot);
  const workflowSessionModel = useMemo(
    () => workflowSessionModelOf(currentSnapshot?.config),
    [currentSnapshot?.config],
  );
  const pending =
    currentSnapshot?.pendingInteractions.find(
      (interaction) =>
        interaction.payload.kind === "permission" || interaction.payload.kind === "userInput",
    ) ?? null;
  const workspaceHookReview = currentSnapshot?.pendingInteractions.find(
    (interaction) => interaction.payload.kind === "workspaceHookReview",
  );
  const notificationEnabled = useCfStoreWithDefault((state) => state.notificationEnabled, true);
  const botElicitationProgress = useCfSessionStore(
    (state) =>
      getTaskUiState(getWorkspaceState(state, workspacePath, workspaceIdentity), sessionId)
        .elicitationRequest,
  );
  const localElicitationDraft = useCfSessionStore((state) => {
    if (!pending || pending.payload.kind !== "userInput") return undefined;
    return getTaskUiState(getWorkspaceState(state, workspacePath, workspaceIdentity), sessionId)
      .elicitationFormDraftsByRequestId[pending.interactionId];
  });
  usePendingInteractionTaskNotifications({
    snapshot: currentSnapshot,
    enabled: notificationEnabled,
    platform,
    formatMessage: intl.formatMessage,
  });
  useEffect(() => {
    connectWorkspaceHookCommands(sessionId, {
      sessionId,
      workspacePath,
      workspaceIdentity,
      remoteSessionId,
      sendCommand,
      onCommandSettled,
    });
    return () => disconnectWorkspaceHookCommands(sessionId, sendCommand);
  }, [
    connectWorkspaceHookCommands,
    disconnectWorkspaceHookCommands,
    onCommandSettled,
    sendCommand,
    sessionId,
    workspaceIdentity,
    remoteSessionId,
    workspacePath,
  ]);
  useEffect(() => {
    if (!workspaceHookReview || workspaceHookReview.payload.kind !== "workspaceHookReview") {
      clearWorkspaceHookReview(sessionId);
      return;
    }
    upsertWorkspaceHookReview(sessionId, {
      request: workspaceHookReview.payload,
      workspacePath,
      sendCommand,
      onCommandSettled,
    });
  }, [
    clearWorkspaceHookReview,
    onCommandSettled,
    sendCommand,
    sessionId,
    upsertWorkspaceHookReview,
    workspaceHookReview,
    workspacePath,
  ]);
  const autoResolutionIntentRef = useRef(createInteractionAutoResolutionIntentTracker());
  const loggedSnoozeSourceIdsRef = useRef(new Set<string>());
  const [permissionResponse, setPermissionResponse] = useState<{
    interactionId: string;
    pending: boolean;
    failed: boolean;
  } | null>(null);
  const permissionResponseFlight = useRef<string | null>(null);

  const resolveInteraction = useCallback(
    async (
      interactionId: string,
      answer: {
        optionId?: string;
        freeText?: string;
        action?: "accept" | "decline" | "cancel";
        content?: Record<string, unknown>;
      },
    ) => {
      const envelope = createCommandEnvelope({
        type: "resolveInteraction",
        sessionId,
        payload: { interactionId, answer },
      });
      pendingCommandRegistry.record(envelope);
      try {
        const ack = await sendCommand(envelope);
        pendingCommandRegistry.applyAck(envelope, ack);
        const accepted =
          ack.status === "accepted" || ack.status === "duplicate" || ack.status === "noop";
        if (!accepted) {
          logger.warn("[v4-interaction] resolveInteraction 被拒绝", {
            interactionId,
            status: ack.status,
            reasonCode: ack.reasonCode,
          });
        }
        return accepted;
      } catch (error) {
        logger.error("[v4-interaction] resolveInteraction 失败", { interactionId, error });
        return false;
      } finally {
        onCommandSettled?.(envelope.commandId);
      }
    },
    [onCommandSettled, sendCommand, sessionId],
  );

  const snoozeAutoResolution = useCallback(
    async (interactionId: string) => {
      return sendInteractionAutoResolutionSnooze({
        sessionId,
        interactionId,
        sendCommand,
        source: "dialog",
        onCommandSettled,
      });
    },
    [onCommandSettled, sendCommand, sessionId],
  );

  const persistElicitationDraft = useCallback(
    (requestId: string, draft: ElicitationFormDraft) => {
      useCfSessionStore
        .getState()
        .setTaskElicitationFormDraft(workspacePath, sessionId, requestId, draft, workspaceIdentity);
    },
    [sessionId, workspaceIdentity, workspacePath],
  );

  const removeElicitationDraft = useCallback(
    (requestId: string) => {
      useCfSessionStore
        .getState()
        .removeTaskElicitationFormDraft(workspacePath, sessionId, requestId, workspaceIdentity);
    },
    [sessionId, workspaceIdentity, workspacePath],
  );

  useEffect(() => {
    if (!currentSnapshot) return;
    const activeRequestIds = new Set(
      currentSnapshot.pendingInteractions
        .filter((interaction) => interaction.payload.kind === "userInput")
        .map((interaction) => interaction.interactionId),
    );
    const taskUiState = getTaskUiState(
      getWorkspaceState(useCfSessionStore.getState(), workspacePath, workspaceIdentity),
      sessionId,
    );
    for (const requestId of Object.keys(taskUiState.elicitationFormDraftsByRequestId)) {
      if (!activeRequestIds.has(requestId)) {
        removeElicitationDraft(requestId);
      }
    }
  }, [currentSnapshot, removeElicitationDraft, sessionId, workspaceIdentity, workspacePath]);

  const sendSnoozeOnce = useCallback(
    async (interactionId: string, autoResolutionReady: boolean) => {
      if (!autoResolutionReady) return false;
      if (!autoResolutionIntentRef.current.consumeSnooze(interactionId, autoResolutionReady)) {
        return true;
      }
      try {
        const accepted = await snoozeAutoResolution(interactionId);
        if (!accepted) autoResolutionIntentRef.current.releaseSnooze(interactionId);
        return accepted;
      } catch {
        autoResolutionIntentRef.current.releaseSnooze(interactionId);
        return false;
      }
    },
    [snoozeAutoResolution],
  );

  useEffect(() => {
    if (pending) {
      void sendSnoozeOnce(pending.interactionId, Boolean(pending.autoResolution));
    }
  }, [pending?.autoResolution, pending?.interactionId, sendSnoozeOnce]);

  if (!pending) {
    return null;
  }

  if (pending.payload.kind === "workspaceHookReview") {
    return null;
  }

  if (pending.payload.kind === "permission") {
    const request = pendingPermissionToLegacyRequest(sessionId, {
      ...pending,
      payload: pending.payload,
    });
    return (
      <PermissionDialog
        key={pending.interactionId}
        request={request}
        workspacePath={workspacePath}
        {...(workspaceIdentity === undefined ? {} : { workspaceIdentity })}
        {...(remoteSessionId === undefined ? {} : { remoteSessionId })}
        {...(workflowSessionModel === undefined ? {} : { workflowSessionModel })}
        isWebRemoteControl={isWebRemoteControl}
        provider={provider}
        responding={
          permissionResponse?.interactionId === pending.interactionId && permissionResponse.pending
        }
        responseError={
          permissionResponse?.interactionId === pending.interactionId && permissionResponse.failed
            ? intl.formatMessage({ id: "chat.permission.responseFailed" })
            : undefined
        }
        onRespond={(_requestId, option: CfPermissionOption, feedback, content) => {
          if (permissionResponseFlight.current === pending.interactionId) return;
          const interactionId = pending.interactionId;
          permissionResponseFlight.current = interactionId;
          setPermissionResponse({ interactionId, pending: true, failed: false });
          // 「Adjusting the settings in the window」）。
          void resolveInteraction(interactionId, {
            optionId: option.optionId,
            ...(feedback ? { freeText: feedback } : {}),
            ...(content === undefined ? {} : { content }),
          }).then((accepted) => {
            if (permissionResponseFlight.current !== interactionId) return;
            permissionResponseFlight.current = null;
            setPermissionResponse({ interactionId, pending: false, failed: !accepted });
          });
        }}
      />
    );
  }

  const projectedElicitationRequest = pendingUserInputToElicitationRequest(sessionId, {
    ...pending,
    payload: pending.payload,
  });
  const elicitationRequest = resolveV4ElicitationRequest(
    projectedElicitationRequest,
    botElicitationProgress,
  );
  if (elicitationRequest) {
    const isExitPlanMode = pending.payload.toolName?.trim().toLowerCase() === "exitplanmode";
    const isAskUserQuestion =
      pending.payload.toolName?.trim().toLowerCase() === "askuserquestion" ||
      pending.autoResolution !== undefined;
    return (
      <ElicitationDialog
        key={buildV4ElicitationProgressKey(elicitationRequest)}
        request={elicitationRequest}
        initialFormDraft={
          botElicitationProgress?.requestId === elicitationRequest.requestId
            ? undefined
            : localElicitationDraft
        }
        onFormDraftChange={persistElicitationDraft}
        autoResolution={isAskUserQuestion ? pending.autoResolution : undefined}
        onFirstInteraction={
          isAskUserQuestion
            ? (source) => {
                if (!loggedSnoozeSourceIdsRef.current.has(pending.interactionId)) {
                  loggedSnoozeSourceIdsRef.current.add(pending.interactionId);
                  logger.debug("[v4-interaction] AskUserQuestion requested to pause auto-end", {
                    interactionId: pending.interactionId,
                    source,
                  });
                }
                autoResolutionIntentRef.current.markInteracted(pending.interactionId);
                return sendSnoozeOnce(pending.interactionId, Boolean(pending.autoResolution));
              }
            : undefined
        }
        onRespond={(_requestId, action, content) => {
          void resolveInteraction(pending.interactionId, {
            action,
            ...(content ? { content } : {}),
          }).then((accepted) => {
            if (!accepted) return;
            removeElicitationDraft(pending.interactionId);
            if (isExitPlanMode) {
              onPlanInteractionAccepted?.(pending.interactionId);
            }
          });
        }}
      />
    );
  }

  const model = pendingUserInputToViewModel({
    ...pending,
    payload: pending.payload,
  });
  return (
    <V4UserInputDialog
      model={model}
      onSubmit={(answer) => {
        void resolveInteraction(pending.interactionId, answer);
      }}
    />
  );
}
