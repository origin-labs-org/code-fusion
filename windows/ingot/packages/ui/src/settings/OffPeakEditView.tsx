

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelSelectionView } from "@origin-ai/cf-services";
import { completeNewModelSelection } from "@origin-ai/cf-provider";
import { FolderOpen } from "lucide-react";
import {
  CF_AGENT_PROVIDER,
  type CfConfigOption,
  type CfOffPeakTask,
  type ModelSelection,
} from "@origin-ai/cf-shared";
import {
  TID_OFFPEAK_EDIT_SUBMIT,
  TID_OFFPEAK_EDIT_VIEW,
  TID_OFFPEAK_FORM_INSTRUCTIONS,
  TID_OFFPEAK_FORM_TITLE,
} from "@origin-ai/cf-shared/test-ids";
import { Button } from "@/components/ui/button.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { Input } from "@/components/ui/input.js";
import { toast } from "@/components/ui/toast.js";
import {
  AUTOMATION_FORM_FIELD_CLASSNAME,
  AutomationInfoIcon,
  AutomationSettingsHistoryTabs,
  type AutomationSettingsHistoryTab,
} from "@/settings/AutomationDesignPrimitives.js";
import {
  AUTOMATION_FORM_INPUT_TYPOGRAPHY_CLASSNAME,
  AUTOMATION_INSTRUCTIONS_TOOLBAR_TRIGGER_CLASSNAME,
  AutomationInstructionsComposer,
  AutomationInstructionsTextarea,
  AutomationInstructionsToolbar,
} from "@/settings/AutomationInstructionsComposer.js";
import { SettingsBreadcrumbReporter } from "@/settings/SettingsHeaderBreadcrumb.js";
import { OffPeakEditActionsMenu } from "@/settings/OffPeakEditActionsMenu.js";
import { OffPeakHistoryTab } from "@/settings/OffPeakHistoryTab.js";
import { AutomationSwitchToggle } from "@/settings/AutomationSwitchToggle.js";
import { cn } from "@/components/lib/utils.js";
import { SETTINGS_FRAME_CONTENT_CLASSNAME } from "@/settings/SettingsPageParts.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import {
  AUTOMATION_DEFAULT_MODE,
  buildAutomationModeOption,
} from "@/settings/automationAgentConfigOptions.js";
import { ConfigSelect } from "@/chat-input-toolbar/display.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { resolveAutomationWorkspaceSelectionKey } from "@/settings/automationWorkspaceOptions.js";
import { useAutomationProjectOptions } from "@/hooks/useAutomationProjectOptions.js";
import {
  OFF_PEAK_CREATE_TOOLTIP_CLASSNAME,
  resolveLocalizedOffPeakCreateTitle,
  shouldShowOffPeakModelSelectionIssue,
} from "@/settings/offPeakUiPresentation.js";
import { ModelConfigSelect, type ModelSelectGroup } from "@/ModelConfigSelect.js";
import { ThoughtLevelCycleControl } from "@/chat-input-toolbar/ThoughtLevelCycleControl.js";
import { resolveModelThoughtOption } from "@/lib/modelThoughtOption.js";

const MODEL_ITEM_NEVER_LOCKED = () => false;

export function buildOffPeakSubmissionModelSelection(
  providerId: string,
  modelId: string,
  displayedReasoningLevel: string | undefined,
): ModelSelection {
  const reasoningLevel = displayedReasoningLevel?.trim();
  return {
    providerId,
    modelId,
    ...(reasoningLevel ? { options: { reasoningLevel } } : {}),
  };
}

export interface OffPeakEditSubmit {
  projectId?: string | null;
  title: string;
  prompt: string;
  permissionMode: string;
  modelSelection: ModelSelection;
  workspacePath: string;
  workspaceIdentity?: string;
}

interface OffPeakEditViewProps {
  editing: CfOffPeakTask | null;
  
  initialDraft?: { title?: string; prompt?: string } | null;
  modelSelectionView: ModelSelectionView;
  defaultWorkspacePath: string;
  defaultWorkspaceIdentity?: string;
  saving: boolean;
  
  createBlocked?: boolean;
  createBlockedTooltip?: string;
  onBack: () => void;
  onSubmit: (input: OffPeakEditSubmit) => Promise<boolean>;
  onOpenSession?: (params: {
    sessionId: string;
    workspacePath: string;
    workspaceIdentity?: string;
  }) => void;
  onDelete?: (task: CfOffPeakTask) => void;
  onDeleteHistory?: (task: CfOffPeakTask) => void;
  onPause?: (task: CfOffPeakTask) => void;
  onContinue?: (task: CfOffPeakTask) => void;
  showToast?: typeof toast;
}

function workspaceBasename(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;
}

export function OffPeakEditView({
  editing,
  initialDraft,
  modelSelectionView,
  defaultWorkspacePath,
  defaultWorkspaceIdentity,
  saving,
  createBlocked = false,
  createBlockedTooltip,
  onBack,
  onSubmit,
  onOpenSession,
  onDelete,
  onDeleteHistory,
  onPause,
  onContinue,
  showToast = toast,
}: OffPeakEditViewProps) {
  const { intl } = useCfIntl();
  const { settings, update: updateSettings } = useSettings();
  const confirmDialog = useConfirmDialog();
  const localWorkspaceOptions = useAutomationProjectOptions();
  const preferredLocalWorkspace =
    localWorkspaceOptions.find(
      (option) => !defaultWorkspaceIdentity && option.workspacePath === defaultWorkspacePath,
    ) ?? localWorkspaceOptions[0];

  const [tab, setTab] = useState<AutomationSettingsHistoryTab>("settings");
  const fullAccessWarningShownRef = useRef(false);
  const readOnlyRef = useRef(false);
  const titleTouchedRef = useRef(false);
  const thoughtTriggerRef = useRef<HTMLSpanElement | null>(null);
  const localizedDefaultCreateTitle = intl.formatMessage({
    id: "offPeak.create.defaultTitle",
  });
  const defaultCreateTitle = initialDraft?.title ?? localizedDefaultCreateTitle;
  const previousLocalizedDefaultTitleRef = useRef(localizedDefaultCreateTitle);
  const [title, setTitle] = useState(editing?.title ?? defaultCreateTitle);
  const [prompt, setPrompt] = useState(editing?.prompt ?? initialDraft?.prompt ?? "");
  const [mode, setMode] = useState<string>(editing?.permissionMode ?? AUTOMATION_DEFAULT_MODE);
  const offPeakProviderId =
    editing?.modelSelection?.providerId ?? modelSelectionView.providers[0]?.providerId ?? "";
  const allowedModels = useMemo(
    () =>
      modelSelectionView.providers
        .find((provider) => provider.providerId === offPeakProviderId)
        ?.models.map((candidate) => candidate.modelId) ?? [],
    [modelSelectionView, offPeakProviderId],
  );
  const initialModel = editing ? (editing.modelSelection?.modelId ?? "") : (allowedModels[0] ?? "");
  const [model, setModel] = useState(initialModel);
  const [thoughtLevel, setThoughtLevel] = useState<string | undefined>(() =>
    editing
      ? editing.modelSelection?.options?.reasoningLevel
      : completeNewModelSelection(modelSelectionView, {
          providerId: offPeakProviderId,
          modelId: initialModel,
        })?.options?.reasoningLevel,
  );
  const handleModelChange = useCallback(
    (value: string) => {
      setModel(value);
      setThoughtLevel(
        completeNewModelSelection(modelSelectionView, {
          providerId: offPeakProviderId,
          modelId: value,
        })?.options?.reasoningLevel,
      );
    },
    [modelSelectionView, offPeakProviderId],
  );
  const [createProjectKey, setCreateProjectKey] = useState(
    preferredLocalWorkspace ? resolveAutomationWorkspaceSelectionKey(preferredLocalWorkspace) : "",
  );
  const modelSelectGroups = useMemo<ModelSelectGroup[]>(
    () =>
      allowedModels.length > 0
        ? [
            {
              key: "off-peak",
              label: "",
              items: allowedModels.map((allowedModel) => ({
                key: allowedModel,
                value: allowedModel,
                name: allowedModel,
              })),
            },
          ]
        : [],
    [allowedModels],
  );
  useEffect(() => {
    if (editing) return;
    if (
      localWorkspaceOptions.some(
        (option) => resolveAutomationWorkspaceSelectionKey(option) === createProjectKey,
      )
    )
      return;
    const key = preferredLocalWorkspace
      ? resolveAutomationWorkspaceSelectionKey(preferredLocalWorkspace)
      : "";
    setCreateProjectKey(key);
    initialRef.current.projectKey = key;
  }, [createProjectKey, editing, localWorkspaceOptions, preferredLocalWorkspace]);
  const thoughtLevelOption = useMemo<CfConfigOption | null>(
    () =>
      resolveModelThoughtOption({
        modelSelectionView,
        providerId: offPeakProviderId,
        modelId: model,
        currentValue: thoughtLevel,
        formatLevelName: (level) => intl.formatMessage({ id: `offPeak.thought.${level}` }),
      }),
    [intl, model, modelSelectionView, offPeakProviderId, thoughtLevel],
  );
  const effectiveThoughtLevel =
    typeof thoughtLevelOption?.currentValue === "string" &&
    thoughtLevelOption.currentValue.trim().length > 0
      ? thoughtLevelOption.currentValue
      : undefined;

  const initialRef = useRef({
    title: editing?.title ?? defaultCreateTitle,
    prompt: editing?.prompt ?? initialDraft?.prompt ?? "",
    mode: editing?.permissionMode ?? AUTOMATION_DEFAULT_MODE,
    model: initialModel,
    thoughtLevel: editing?.modelSelection?.options?.reasoningLevel,
    projectKey: preferredLocalWorkspace
      ? resolveAutomationWorkspaceSelectionKey(preferredLocalWorkspace)
      : "",
  });
  useEffect(() => {
    const nextTitle = resolveLocalizedOffPeakCreateTitle({
      currentTitle: title,
      hasInitialTitle: Boolean(initialDraft?.title),
      isEditing: Boolean(editing),
      nextDefaultTitle: localizedDefaultCreateTitle,
      previousDefaultTitle: previousLocalizedDefaultTitleRef.current,
      titleTouched: titleTouchedRef.current,
    });
    previousLocalizedDefaultTitleRef.current = localizedDefaultCreateTitle;
    if (nextTitle === title) return;
    setTitle(nextTitle);
    initialRef.current.title = nextTitle;
  }, [editing, initialDraft?.title, localizedDefaultCreateTitle, title]);
  const dirty =
    title !== initialRef.current.title ||
    prompt !== initialRef.current.prompt ||
    mode !== initialRef.current.mode ||
    model !== initialRef.current.model ||
    thoughtLevel !== initialRef.current.thoughtLevel ||
    (!editing && createProjectKey !== initialRef.current.projectKey);
  const handleBack = useCallback(async () => {
    if (!dirty || readOnlyRef.current) {
      onBack();
      return;
    }
    const confirmed = await confirmDialog({
      title: intl.formatMessage({ id: "offPeak.discard.title" }),
      description: intl.formatMessage({ id: "offPeak.discard.description" }),
      confirmLabel: intl.formatMessage({ id: "offPeak.discard.confirm" }),
      confirmVariant: "destructive",
      showCloseButton: true,
      showKeyboardHints: false,
      presentation: "automation-confirmation",
    });
    if (confirmed) onBack();
  }, [confirmDialog, dirty, intl, onBack]);

  const keepAwake = settings?.keepAwakeWhileRunning ?? false;
  const readOnly = Boolean(editing && editing.status !== "queued" && editing.status !== "paused");
  readOnlyRef.current = readOnly;
  const selectedProject = localWorkspaceOptions.find(
    (option) => resolveAutomationWorkspaceSelectionKey(option) === createProjectKey,
  );
  const workspacePath = editing?.workspacePath ?? selectedProject?.workspacePath ?? "";
  const canSubmit =
    title.trim().length > 0 &&
    prompt.trim().length > 0 &&
    Boolean(editing || selectedProject) &&
    Boolean(model) &&
    Boolean(effectiveThoughtLevel) &&
    !saving &&
    !createBlocked &&
    !readOnly;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    if (mode !== "yolo" && !fullAccessWarningShownRef.current) {
      fullAccessWarningShownRef.current = true;
      showToast(intl.formatMessage({ id: "offPeak.form.fullAccessHint" }), {
        durationMs: 8000,
        position: "top-center",
        variant: "info",
        dismissible: true,
        dismissLabel: intl.formatMessage({ id: "common.close" }),
      });
    }
    const ok = await onSubmit({
      ...(!editing && selectedProject ? { projectId: selectedProject.projectId } : {}),
      title: title.trim(),
      prompt: prompt.trim(),
      permissionMode: mode,
      modelSelection: buildOffPeakSubmissionModelSelection(
        offPeakProviderId,
        model,
        effectiveThoughtLevel,
      ),
      workspacePath,
      ...(editing?.workspaceIdentity ? { workspaceIdentity: editing.workspaceIdentity } : {}),
    });
    if (ok) onBack();
  }, [
    canSubmit,
    editing,
    effectiveThoughtLevel,
    intl,
    mode,
    model,
    offPeakProviderId,
    onBack,
    onSubmit,
    prompt,
    title,
    workspacePath,
    selectedProject,
  ]);

  const modeOption = useMemo(() => buildAutomationModeOption(mode), [mode]);
  const createSubmitButton = (
    <Button
      type="button"
      variant="default"
      size="lg"
      data-testid={TID_OFFPEAK_EDIT_SUBMIT}
      disabled={!canSubmit}
      onClick={() => void handleSubmit()}
    >
      {intl.formatMessage({ id: "offPeak.create.submit" })}
    </Button>
  );

  return (
    <div
      className={cn(SETTINGS_FRAME_CONTENT_CLASSNAME, "relative flex flex-col gap-6")}
      data-testid={TID_OFFPEAK_EDIT_VIEW}
    >
      <SettingsBreadcrumbReporter
        items={[
          {
            label: editing?.title ?? intl.formatMessage({ id: "offPeak.create.title" }),
          },
        ]}
        onSectionSelect={() => void handleBack()}
      />

      <div className="space-y-1.5">
        <h1 data-testid="offpeak-edit-title" className="text-ui-xl font-semibold text-foreground">
          {intl.formatMessage({
            id: editing ? "offPeak.edit.title" : "offPeak.create.title",
          })}
        </h1>
        <p data-testid="offpeak-edit-subtitle" className="text-ui-base text-foreground-subtle">
          {intl.formatMessage({
            id: editing ? "offPeak.edit.subtitle" : "offPeak.create.subtitle",
          })}
        </p>
      </div>

      {editing?.modelSelectionIssue && shouldShowOffPeakModelSelectionIssue(editing.status) ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-[10px] border border-warning/40 bg-warning/10 px-3 py-2 text-ui-base text-warning"
        >
          <AutomationInfoIcon className="size-4 shrink-0" aria-hidden="true" />
          {intl.formatMessage({ id: "offPeak.modelSelection.repairRequired" })}
        </div>
      ) : null}

      <div className="flex min-w-0 flex-wrap items-center gap-4 sm:flex-nowrap">
        <div className="flex shrink-0 items-center gap-2">
          <AutomationSwitchToggle
            checked={keepAwake}
            ariaLabel={intl.formatMessage({
              id: "offPeak.form.keepAwakeLabel",
            })}
            onChange={(value) => void updateSettings({ keepAwakeWhileRunning: value })}
            color="blue"
            size="sm"
          />
          <span className="text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "offPeak.form.keepAwakeLabel" })}
          </span>
        </div>
      </div>

      {}
      <div className="flex items-center justify-between">
        <AutomationSettingsHistoryTabs
          value={tab}
          settingsLabel={intl.formatMessage({ id: "offPeak.tab.settings" })}
          historyLabel={intl.formatMessage({ id: "offPeak.tab.history" })}
          onValueChange={setTab}
        />
        {tab !== "history" && !editing ? (
          createBlockedTooltip ? (
            <ControlHintTooltip
              title={createBlockedTooltip}
              side="top"
              align="center"
              className={OFF_PEAK_CREATE_TOOLTIP_CLASSNAME}
            >
              <span className="inline-flex">{createSubmitButton}</span>
            </ControlHintTooltip>
          ) : (
            createSubmitButton
          )
        ) : tab !== "history" && !readOnly ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-testid={TID_OFFPEAK_EDIT_SUBMIT}
              disabled={!canSubmit}
              onClick={() => void handleSubmit()}
              className="inline-flex h-8 items-center rounded-lg border-0 bg-white px-3 text-ui-base font-medium text-black shadow-none outline-none transition-colors hover:bg-white/90 focus-visible:ring-0 disabled:pointer-events-none disabled:opacity-40"
            >
              {intl.formatMessage({ id: "offPeak.edit.save" })}
            </button>
            {editing ? (
              <OffPeakEditActionsMenu
                task={editing}
                {...(onPause ? { onPause } : {})}
                {...(onContinue ? { onContinue } : {})}
                {...(onDelete ? { onDelete } : {})}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {editing && tab === "settings" ? (
        <div className="flex min-h-11 items-center gap-3 rounded-[10px] bg-surface px-3 py-3 text-ui-base leading-5 text-foreground-subtle sm:py-0">
          <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
            <AutomationInfoIcon className="size-4" aria-hidden="true" />
          </span>
          {intl.formatMessage({ id: "offPeak.keepAwakeBanner" })}
        </div>
      ) : null}

      {tab === "history" ? (
        <OffPeakHistoryTab
          task={editing}
          {...(onOpenSession
            ? {
                onOpenSession: (task: CfOffPeakTask) =>
                  task.sessionId
                    ? onOpenSession({
                        sessionId: task.sessionId,
                        workspacePath: task.workspacePath,
                        ...(task.workspaceIdentity
                          ? { workspaceIdentity: task.workspaceIdentity }
                          : {}),
                      })
                    : undefined,
              }
            : {})}
          {...(onDeleteHistory ? { onDelete: onDeleteHistory } : {})}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {editing?.sessionId ? (
            <div className={AUTOMATION_FORM_FIELD_CLASSNAME}>
              <div className="flex min-w-0 items-center gap-2 text-ui-base leading-5">
                <span className="min-w-0 truncate text-foreground">
                  {intl.formatMessage(
                    { id: "offPeak.boundSession.label" },
                    { title: editing.sessionTitle ?? editing.sessionId },
                  )}
                </span>
                {onOpenSession ? (
                  <button
                    type="button"
                    className="shrink-0 text-foreground-subtle underline-offset-2 hover:underline"
                    onClick={() =>
                      onOpenSession({
                        sessionId: editing.sessionId!,
                        workspacePath: editing.workspacePath,
                        ...(editing.workspaceIdentity
                          ? { workspaceIdentity: editing.workspaceIdentity }
                          : {}),
                      })
                    }
                  >
                    {intl.formatMessage({ id: "offPeak.goToSession" })}
                  </button>
                ) : null}
              </div>
              <span className="text-ui-base leading-5 text-foreground-subtle">
                {intl.formatMessage({ id: "offPeak.boundSession.hint" })}
              </span>
            </div>
          ) : null}
          {}
          <div className={AUTOMATION_FORM_FIELD_CLASSNAME}>
            <span className="text-ui-base font-normal leading-5 text-foreground-subtle">
              {intl.formatMessage({ id: "offPeak.form.titleLabel" })}
            </span>
            {}
            <Input
              value={title}
              disabled={readOnly}
              data-testid={TID_OFFPEAK_FORM_TITLE}
              placeholder={intl.formatMessage({
                id: "offPeak.form.titlePlaceholder",
              })}
              onChange={(event) => {
                titleTouchedRef.current = true;
                setTitle(event.target.value);
              }}
              className={cn(
                "h-9 rounded-lg bg-card px-2 text-foreground hover:bg-surface-hover focus-visible:bg-card",
                AUTOMATION_FORM_INPUT_TYPOGRAPHY_CLASSNAME,
              )}
            />
          </div>

          {}
          <div className={AUTOMATION_FORM_FIELD_CLASSNAME}>
            <span className="text-ui-base font-normal leading-5 text-foreground-subtle">
              {intl.formatMessage({ id: "offPeak.form.instructionsLabel" })}
            </span>
            <AutomationInstructionsComposer>
              <AutomationInstructionsTextarea
                data-testid={TID_OFFPEAK_FORM_INSTRUCTIONS}
                value={prompt}
                disabled={readOnly}
                placeholder={intl.formatMessage({
                  id: "offPeak.form.instructionsPlaceholder",
                })}
                onChange={(event) => setPrompt(event.target.value)}
              />
              <AutomationInstructionsToolbar>
                <div className="flex min-w-0 flex-wrap items-center gap-0">
                  {}
                  {}
                  {editing ? (
                    <span className="flex h-7 min-w-0 items-center gap-1 rounded-full px-2 text-ui-base font-normal leading-snug text-foreground-subtle">
                      <FolderOpen className="size-4 shrink-0" aria-hidden="true" />
                      <span className="max-w-40 truncate" title={workspacePath}>
                        {workspaceBasename(workspacePath)}
                      </span>
                    </span>
                  ) : localWorkspaceOptions.length > 0 ? (
                    <Select value={createProjectKey} onValueChange={setCreateProjectKey}>
                      <SelectTrigger
                        data-testid="offpeak-project-select"
                        variant="ghost"
                        className={AUTOMATION_INSTRUCTIONS_TOOLBAR_TRIGGER_CLASSNAME}
                      >
                        <FolderOpen className="size-4" aria-hidden="true" />
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {localWorkspaceOptions.map((option) => (
                          <SelectItem
                            key={resolveAutomationWorkspaceSelectionKey(option)}
                            value={resolveAutomationWorkspaceSelectionKey(option)}
                            data-project-id={option.projectId}
                            data-project-name={option.label}
                          >
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled
                      className={cn(
                        AUTOMATION_INSTRUCTIONS_TOOLBAR_TRIGGER_CLASSNAME,
                        "gap-1 px-2 text-foreground-subtlest",
                      )}
                    >
                      <FolderOpen className="size-4" aria-hidden="true" />
                      {intl.formatMessage({
                        id: "automations.form.project.localRequired",
                      })}
                    </Button>
                  )}
                  {}
                  <ConfigSelect
                    option={modeOption}
                    provider={CF_AGENT_PROVIDER}
                    onValueChange={setMode}
                    disabled={readOnly}
                    tooltipTitle={intl.formatMessage({
                      id: "chat.toolbar.mode.label",
                    })}
                    triggerVariant="ghost"
                    triggerSize="default"
                    triggerClassName={cn(
                      AUTOMATION_INSTRUCTIONS_TOOLBAR_TRIGGER_CLASSNAME,
                      "w-fit max-w-56 min-w-0 shrink justify-start gap-1 px-2",
                    )}
                    labelVisibilityClassName="inline-flex min-w-0 truncate text-left"
                    restoreFocusSelector={null}
                  />
                </div>
                {}
                <div className="flex w-full shrink-0 flex-nowrap items-center justify-end gap-0 sm:w-auto">
                  {}
                  <ModelConfigSelect
                    modelGroups={modelSelectGroups}
                    normalizedValue={model}
                    triggerLabel={model || intl.formatMessage({ id: "offPeak.form.modelLabel" })}
                    showProviderLevel={false}
                    showManageModelsAction={false}
                    lockReasonMessage=""
                    isItemLocked={MODEL_ITEM_NEVER_LOCKED}
                    onValueChange={handleModelChange}
                    disabled={readOnly || allowedModels.length === 0}
                    tooltipTitle={intl.formatMessage({
                      id: "offPeak.form.modelLabel",
                    })}
                    contentSide="top"
                    contentAlign="end"
                    focusSelectorOnClose={null}
                    labelVisibilityClassName="inline-flex min-w-0"
                    triggerClassName={cn(
                      AUTOMATION_INSTRUCTIONS_TOOLBAR_TRIGGER_CLASSNAME,
                      "w-fit max-w-72 min-w-0 shrink justify-between px-2",
                    )}
                    triggerLabelClassName="inline-flex min-w-0 truncate text-left"
                  />
                  {}
                  {thoughtLevelOption ? (
                    <ThoughtLevelCycleControl
                      intl={intl}
                      option={thoughtLevelOption}
                      provider={CF_AGENT_PROVIDER}
                      disabled={readOnly}
                      triggerRef={thoughtTriggerRef}
                      triggerClassName={AUTOMATION_INSTRUCTIONS_TOOLBAR_TRIGGER_CLASSNAME}
                      interactionMode="select"
                      restoreFocusSelector={null}
                      labelVisibilityClassName="inline-flex min-w-0"
                      onValueChange={setThoughtLevel}
                    />
                  ) : null}
                </div>
              </AutomationInstructionsToolbar>
            </AutomationInstructionsComposer>
            {}
            <div className="mt-1 flex items-start gap-1.5 text-ui-base leading-5 text-foreground-subtle">
              <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
                <AutomationInfoIcon className="size-4" />
              </span>
              {intl.formatMessage({ id: "offPeak.form.permissionWarning" })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
