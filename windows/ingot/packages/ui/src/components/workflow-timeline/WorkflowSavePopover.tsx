//
//
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { SparkleIcon } from "lucide-react";
import type { CfSavedWorkflowScope, CfWorkflowsSaveResult } from "@origin-ai/cf-shared";
import { Button } from "@/components/ui/button.js";
import { Popover, PopoverAnchor, PopoverContent, PopoverTitle } from "@/components/ui/popover.js";
import { Spinner } from "@/components/ui/spinner.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { WorkflowSaveFields, type WorkflowSaveFailure } from "./WorkflowSaveFields.js";
import {
  initialWorkflowSaveDraft,
  isValidSavedWorkflowNameText,
  savedWorkflowPathPreview,
  type WorkflowSaveDraft,
} from "./workflowRunSave.js";

const NAME_PROBE_DEBOUNCE_MS = 320;

export interface WorkflowSavePopoverHost {
  
  runName?: string;
  
  directSaveUnsupported: boolean;
  
  scopeLocked: boolean;
  saving: boolean;
  save: (input: {
    name: string;
    scope: CfSavedWorkflowScope;
    meta: { description: string };
    overwrite?: boolean;
  }) => Promise<CfWorkflowsSaveResult>;
  checkNameTaken: (name: string, scope: CfSavedWorkflowScope) => Promise<boolean>;
  
  sendLead?: (draft: WorkflowSaveDraft) => Promise<void>;
  
  onSaved: (saved: { name: string; scope: CfSavedWorkflowScope }) => void;
}

export function WorkflowSavePopover({
  anchorRef,
  host,
  onOpenChange,
  open,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  host: WorkflowSavePopoverHost;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={anchorRef as RefObject<HTMLElement>} />
      <PopoverContent
        align="end"
        className="w-80 max-w-[calc(100vw-16px)] gap-2.5"
        collisionPadding={8}
        data-testid="workflow-save-popover"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") event.stopPropagation();
        }}
        onInteractOutside={(event) => {
          const target = event.target;
          if (target instanceof Node && anchorRef.current?.contains(target)) event.preventDefault();
        }}
      >
        {}
        {open ? <WorkflowSaveForm host={host} onClose={() => onOpenChange(false)} /> : null}
      </PopoverContent>
    </Popover>
  );
}

function WorkflowSaveForm({
  host,
  onClose,
}: {
  host: WorkflowSavePopoverHost;
  onClose: () => void;
}) {
  const { intl } = useCfIntl();
  const format = useCallback((id: string) => intl.formatMessage({ id }), [intl]);
  const [draft, setDraft] = useState<WorkflowSaveDraft>(() =>
    initialWorkflowSaveDraft({
      ...(host.runName === undefined ? {} : { runName: host.runName }),
      ...(host.scopeLocked ? { scope: "project" as const } : {}),
    }),
  );
  const [probe, setProbe] = useState({ taken: false, shadowing: false });
  const [failure, setFailure] = useState<WorkflowSaveFailure | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const name = draft.name.trim();
  const nameInvalid = name.length > 0 && !isValidSavedWorkflowNameText(name);
  const canDirectSave =
    !host.directSaveUnsupported && name.length > 0 && !nameInvalid && !host.saving;

  const { checkNameTaken, directSaveUnsupported, scopeLocked } = host;
  const { scope } = draft;
  useEffect(() => {
    setProbe({ taken: false, shadowing: false });
    if (directSaveUnsupported || name.length === 0 || !isValidSavedWorkflowNameText(name)) return;
    let cancelled = false;
    const other: CfSavedWorkflowScope = scope === "global" ? "project" : "global";
    const timer = window.setTimeout(() => {
      void Promise.all([
        checkNameTaken(name, scope),
        scopeLocked ? Promise.resolve(false) : checkNameTaken(name, other),
      ]).then(([taken, shadowing]) => {
        if (!cancelled) setProbe({ taken, shadowing });
      });
    }, NAME_PROBE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [checkNameTaken, directSaveUnsupported, name, scope, scopeLocked]);

  const update = (next: Partial<WorkflowSaveDraft>) => {
    setDraft((current) => ({ ...current, ...next }));
    setFailure(undefined);
  };

  const handleLead = () => {
    if (host.sendLead === undefined || sending || host.saving) return;
    setSending(true);
    void host.sendLead({ ...draft, name }).then(
      () => onClose(),
      () => setSending(false),
    );
  };

  const handleDirectSave = () => {
    if (!canDirectSave) return;
    setFailure(undefined);
    void host
      .save({
        name,
        scope,
        meta: { description: draft.description.trim() || name },
        ...(probe.taken ? { overwrite: true } : {}),
      })
      .then(
        (result) => {
          if (result.ok) {
            host.onSaved({ name: result.name, scope: result.scope });
            onClose();
            return;
          }
          if (result.reason === "target_exists") {
            setProbe((current) => ({ ...current, taken: true }));
            return;
          }
          setFailure({
            reason: result.reason,
            ...(result.detail === undefined ? {} : { detail: result.detail }),
          });
        },
        (error: unknown) => {
          setFailure({
            reason: "generic",
            detail: error instanceof Error ? error.message : String(error),
          });
        },
      );
  };

  const pathPreview = useMemo(
    () => savedWorkflowPathPreview(scope, name.length > 0 ? name : "…"),
    [name, scope],
  );
  const submitLabel = host.saving
    ? format("chat.toolCall.workflow.saveRun.submit.saving")
    : probe.taken
      ? format("chat.toolCall.workflow.saveRun.submit.overwrite")
      : format("chat.toolCall.workflow.saveRun.submit");

  return (
    <div
      className="flex flex-col gap-2.5"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          handleLead();
        }
      }}
    >
      <PopoverTitle>{format("chat.toolCall.workflow.saveRun.title")}</PopoverTitle>
      {host.sendLead === undefined ? null : (
        <div className="flex flex-col gap-1.5">
          <Button
            className="h-8 w-full"
            data-icon="inline-start"
            data-testid="workflow-save-lead"
            disabled={sending || host.saving}
            onClick={handleLead}
            type="button"
          >
            {sending ? <Spinner className="size-3.5" /> : <SparkleIcon className="size-3.5" />}
            {format(
              sending
                ? "chat.toolCall.workflow.saveRun.lead.sending"
                : "chat.toolCall.workflow.saveRun.lead",
            )}
          </Button>
          <p className="text-ui-sm leading-snug text-foreground-subtle">
            {format("chat.toolCall.workflow.saveRun.lead.hint")}
            {host.directSaveUnsupported
              ? ` ${format("chat.toolCall.workflow.saveRun.lead.unsupported")}`
              : ""}
          </p>
        </div>
      )}
      {host.directSaveUnsupported ? null : (
        <WorkflowSaveFields
          draft={draft}
          failure={failure}
          nameInvalid={nameInvalid}
          nameRef={nameRef}
          onDirectSave={handleDirectSave}
          pathPreview={pathPreview}
          saving={host.saving}
          scopeLocked={host.scopeLocked}
          shadowing={probe.shadowing}
          showDivider={host.sendLead !== undefined}
          submitDisabled={!canDirectSave}
          submitLabel={submitLabel}
          taken={probe.taken}
          update={update}
        />
      )}
    </div>
  );
}
