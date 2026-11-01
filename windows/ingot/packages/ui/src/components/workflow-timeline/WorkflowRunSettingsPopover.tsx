// ============================================================
// ============================================================
//

import { useCallback, useRef, useState, type RefObject } from "react";
import type { CommandAck, WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import { Button } from "@/components/ui/button.js";
import { Popover, PopoverAnchor, PopoverContent, PopoverTitle } from "@/components/ui/popover.js";
import { Spinner } from "@/components/ui/spinner.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import {
  WorkflowRunSettingsBoundField,
  WorkflowRunSettingsModelField,
} from "./WorkflowRunSettingsFields.js";
import {
  useWorkflowSettingsModelChoices,
  type WorkflowSettingsModelScope,
} from "./useWorkflowSettingsModelChoices.js";
import {
  describeWorkflowRunSettingsRejection,
  initialWorkflowRunSettingsDraft,
  workflowRunDefaultConcurrency,
  workflowRunSettingsChange,
  workflowRunSettingsConsequenceId,
  workflowRunSettingsRejectionDetail,
  workflowRunSettingsRejectionMessageId,
  type WorkflowRunSettingsChange,
  type WorkflowRunSettingsDraft,
  type WorkflowRunSettingsRejection,
} from "./workflowRunSettings.js";

export interface WorkflowRunSettingsHost extends WorkflowSettingsModelScope {
  
  apply: (change: WorkflowRunSettingsChange) => Promise<CommandAck>;
}

export interface WorkflowRunSettingsAccepted {
  runId: string;
  toolCallId: string;
}

export function useWorkflowRunSettingsPopoverState() {
  const anchorRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const toggleFrom = useCallback(
    (element: HTMLElement) => {
      if (open && anchorRef.current === element) {
        setOpen(false);
        return;
      }
      anchorRef.current = element;
      setOpen(true);
    },
    [open],
  );
  return { anchorRef, open, setOpen, toggleFrom };
}

export function WorkflowRunSettingsPopover({
  anchorRef,
  host,
  onAccepted,
  onOpenChange,
  open,
  run,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  host: WorkflowRunSettingsHost;
  onAccepted?: (accepted: WorkflowRunSettingsAccepted) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  run: WorkflowRunState;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={anchorRef as RefObject<HTMLElement>} />
      <PopoverContent
        align="end"
        className="gap-2.5"
        data-testid="workflow-run-settings-popover"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") event.stopPropagation();
        }}
        onInteractOutside={(event) => {
          const target = event.target;
          if (target instanceof Node && anchorRef.current?.contains(target)) event.preventDefault();
        }}
      >
        <WorkflowRunSettingsForm
          host={host}
          onClose={() => onOpenChange(false)}
          run={run}
          {...(onAccepted === undefined ? {} : { onAccepted })}
        />
      </PopoverContent>
    </Popover>
  );
}

function WorkflowRunSettingsForm({
  host,
  onAccepted,
  onClose,
  run,
}: {
  host: WorkflowRunSettingsHost;
  onAccepted?: (accepted: WorkflowRunSettingsAccepted) => void;
  onClose: () => void;
  run: WorkflowRunState;
}) {
  const { intl } = useCfIntl();
  const format = useCallback(
    (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values),
    [intl],
  );
  // （useWorkflowSettingsModelChoices.ts）。
  const choices = useWorkflowSettingsModelChoices(host);

  const [initial] = useState(() => initialWorkflowRunSettingsDraft(run));
  const [draft, setDraft] = useState<WorkflowRunSettingsDraft>(initial);
  const [pending, setPending] = useState(false);
  const [rejection, setRejection] = useState<WorkflowRunSettingsRejection | undefined>(undefined);
  const defaultConcurrency = workflowRunDefaultConcurrency(run);
  const change = workflowRunSettingsChange(initial, draft, defaultConcurrency);
  const updateDraft = (next: WorkflowRunSettingsDraft) => {
    setDraft(next);
    setRejection(undefined);
  };

  const draftModel = draft.model;
  const face = choices.describe(draftModel);
  const handleModelChange = (value: string) => {
    updateDraft({ ...draft, model: choices.pick(value, draftModel) });
  };

  const handleApply = () => {
    if (change === undefined) return;
    setPending(true);
    setRejection(undefined);
    host.apply(change).then(
      (ack) => {
        const next = describeWorkflowRunSettingsRejection(ack);
        if (next !== undefined) {
          logger.warn("[workflow-run] 调整设置被拒绝", {
            reasonCode: ack.reasonCode,
            runId: run.runId,
            status: ack.status,
          });
          setRejection(next);
          setPending(false);
          return;
        }
        const result = ack.result;
        if (result?.type === "amendWorkflowRunSettings") {
          onAccepted?.({ runId: result.runId, toolCallId: result.toolCallId });
        }
        onClose();
      },
      (error: unknown) => {
        logger.warn("[workflow-run] 调整设置命令失败", { runId: run.runId, error: String(error) });
        setRejection({
          reason: "generic",
          code: error instanceof Error ? error.message : String(error),
        });
        setPending(false);
      },
    );
  };

  const rejectionDetail =
    rejection === undefined ? undefined : workflowRunSettingsRejectionDetail(rejection);
  const consequenceId = workflowRunSettingsConsequenceId(run.status, change);
  return (
    <>
      <PopoverTitle>{format("chat.toolCall.workflow.run.settings.title")}</PopoverTitle>
      <WorkflowRunSettingsModelField
        disabled={pending || choices.loading}
        groups={choices.groups}
        leadingItem={choices.sessionModelItem}
        noCatalog={choices.noCatalog}
        onLevelChange={(level) => {
          if (draftModel.kind !== "model" || level === draftModel.level) return;
          updateDraft({ ...draft, model: { ...draftModel, level } });
        }}
        onValueChange={handleModelChange}
        thoughtOption={face.thoughtOption}
        triggerLabel={face.triggerLabel}
        value={face.value}
        {...(draftModel.kind === "session"
          ? { badge: { text: choices.sessionBadge, tone: "subtle" as const } }
          : face.unavailable
            ? {
                badge: {
                  text: format("chat.toolCall.workflow.run.settings.model.unavailable"),
                  tone: "warning" as const,
                },
              }
            : {})}
      />
      <WorkflowRunSettingsBoundField
        bound={draft.bound}
        defaultConcurrency={defaultConcurrency}
        disabled={pending}
        onChange={(bound) => updateDraft({ ...draft, bound })}
      />
      {}
      <p
        className="min-h-lh text-ui-sm text-foreground-subtle"
        data-testid="workflow-run-settings-consequence"
      >
        {consequenceId === undefined ? null : format(consequenceId)}
      </p>
      {rejection === undefined ? null : (
        <div
          className="text-ui-xs text-warning"
          data-testid="workflow-run-settings-rejection"
          role="status"
        >
          <span>
            {format(workflowRunSettingsRejectionMessageId(rejection), {
              code: rejection.code,
              message: rejection.message ?? rejection.code,
            })}
          </span>
          {rejectionDetail === undefined ? null : (
            <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-ui-xs text-foreground-subtle">
              {rejectionDetail}
            </pre>
          )}
        </div>
      )}
      <div className="flex justify-end">
        <Button
          data-testid="workflow-run-settings-apply"
          disabled={change === undefined || pending || face.unavailable}
          onClick={handleApply}
          size="default"
          type="button"
          variant="default"
        >
          {pending ? <Spinner className="size-3.5" /> : null}
          {format(
            pending
              ? "chat.toolCall.workflow.run.settings.applying"
              : "chat.toolCall.workflow.run.settings.apply",
          )}
        </Button>
      </div>
    </>
  );
}
