import { useSavedWorkflowProjectOptions } from "@/project-sidebar/useSavedWorkflowProjectOptions.js";
// 「Saving the run, and running it again」）：
//
//
import { useMemo, useRef, useState, type ReactNode } from "react";
import { CheckIcon, ArrowUpRightIcon, PlayIcon, SaveIcon } from "lucide-react";
import {
  resolveWorkspaceKey,
  type CfSavedWorkflowEntry,
  type CfWorkflowsForRunCandidate,
} from "@origin-ai/cf-shared";
import { Button } from "@/components/ui/button.js";
import { Spinner } from "@/components/ui/spinner.js";
import { toast } from "@/components/ui/toast.js";
import { cn } from "@/components/lib/utils.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { useWorkflowRunSave } from "@/project-workflow/useWorkflowRunSave.js";
import { useSavedWorkflowHub } from "@/v4/savedWorkflowHubContext.js";
import { useOptionalServices } from "@/hooks/useServices.js";
import { SavedWorkflowLaunchDialog } from "@/settings/saved-workflows/SavedWorkflowLaunchDialog.js";
import { WorkflowSavePopover } from "@/components/workflow-timeline/WorkflowSavePopover.js";
import {
  buildWorkflowSaveRequestPrompt,
  type WorkflowSaveDraft,
} from "@/components/workflow-timeline/workflowRunSave.js";

export interface WorkflowRunSaveSlotsHost {
  sessionId?: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  runId: string;
  
  runName?: string;
  
  candidates?: readonly CfWorkflowsForRunCandidate[];
  
  canSave?: boolean;
  
  sendLead?: (text: string) => Promise<void>;
  
  verbWord?: "card" | "never";
}

export interface WorkflowRunSaveSlots {
  leading: ReactNode;
  trailing: ReactNode;
}

const SAVE_WORD_CONTAINER = "@[480px]/wf-card:inline";

export function useWorkflowRunSaveSlots(host: WorkflowRunSaveSlotsHost): WorkflowRunSaveSlots {
  const { intl, locale } = useCfIntl();
  const format = (id: string) => intl.formatMessage({ id });
  const hub = useSavedWorkflowHub();
  const anchorRef = useRef<HTMLElement | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [launchEntry, setLaunchEntry] = useState<CfSavedWorkflowEntry | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);

  const controller = useWorkflowRunSave({
    sessionId: host.sessionId,
    workspacePath: host.workspacePath,
    ...(host.workspaceIdentity === undefined ? {} : { workspaceIdentity: host.workspaceIdentity }),
    ...(host.remoteSessionId === undefined ? {} : { remoteSessionId: host.remoteSessionId }),
    runId: host.runId,
    ...(host.candidates === undefined ? {} : { candidates: host.candidates }),
    ...(hub === null ? {} : { onNavigateToRun: hub.navigateToRun }),
  });
  const entry = controller.entry;

  const projects = useSavedWorkflowProjectOptions();
  const localProjects = useMemo(
    () => projects.filter((project) => !project.workspaceIdentity),
    [projects],
  );
  const runProjectKey = useMemo(
    () =>
      resolveWorkspaceKey({
        workspacePath: host.workspacePath,
        ...(host.workspaceIdentity ? { workspaceIdentity: host.workspaceIdentity } : {}),
      }),
    [host.workspacePath, host.workspaceIdentity],
  );

  const sendLead = host.sendLead;
  const leadHandler =
    sendLead === undefined
      ? undefined
      : async (draft: WorkflowSaveDraft) => {
          await sendLead(
            buildWorkflowSaveRequestPrompt({
              locale,
              runId: host.runId,
              ...(host.runName === undefined ? {} : { runName: host.runName }),
              name: draft.name,
              scope: draft.scope,
              description: draft.description,
            }),
          );
        };

  const handleRunAgain = () => {
    if (entry === undefined || controller.launching) return;
    const hasArgs = entry.args !== undefined && Object.keys(entry.args).length > 0;
    if (hasArgs || entry.scope === "global") {
      controller.clearLaunchError();
      setLaunchEntry(entry);
      return;
    }
    void controller.launch(entry, {}).then((result) => {
      if (!result.ok) {
        toast(intl.formatMessage({ id: `workflows.hub.launch.error.${result.error.reason}` }));
      }
    });
  };

  const leading =
    entry === undefined ? null : (
      <WorkflowRunSavedChip
        entry={entry}
        label={format("chat.toolCall.workflow.saveRun.chip")}
        {...(hub === null
          ? {}
          : {
              hint: format("chat.toolCall.workflow.saveRun.chip.hint"),
              onOpen: () =>
                hub.openWorkflow({
                  name: entry.name,
                  scope: entry.scope,
                  workspacePath: host.workspacePath,
                  ...(host.workspaceIdentity ? { workspaceIdentity: host.workspaceIdentity } : {}),
                }),
            })}
      />
    );

  if (host.canSave !== true) return { leading, trailing: null };

  const verb =
    entry === undefined
      ? {
          label: format("chat.toolCall.workflow.saveRun.action"),
          icon: <SaveIcon className="size-3.5" />,
          testId: "workflow-save-open",
          onClick: (element: HTMLElement) => {
            anchorRef.current = element;
            setPopoverOpen((open) => !open);
          },
        }
      : {
          label: controller.launching
            ? format("chat.toolCall.workflow.saveRun.starting")
            : format("chat.toolCall.workflow.saveRun.runAgain"),
          icon: controller.launching ? (
            <Spinner className="size-3.5" />
          ) : (
            <PlayIcon className="size-3.5" />
          ),
          testId: "workflow-save-run-again",
          onClick: handleRunAgain,
        };

  const trailing = (
    <>
      <ControlHintTooltip title={verb.label} side="top">
        <Button
          aria-expanded={entry === undefined ? popoverOpen : undefined}
          aria-haspopup={entry === undefined ? "dialog" : undefined}
          aria-label={verb.label}
          data-icon="inline-start"
          data-testid={verb.testId}
          disabled={controller.launching}
          onClick={(event) => verb.onClick(event.currentTarget)}
          size="sm"
          type="button"
          variant="outline"
        >
          {verb.icon}
          {}
          <span
            className={host.verbWord === "never" ? undefined : cn("hidden", SAVE_WORD_CONTAINER)}
          >
            {verb.label}
          </span>
        </Button>
      </ControlHintTooltip>
      <WorkflowSavePopover
        anchorRef={anchorRef}
        host={{
          ...(host.runName === undefined ? {} : { runName: host.runName }),
          directSaveUnsupported: controller.directSaveUnsupported,
          scopeLocked: controller.scopeLocked,
          saving: controller.saving,
          save: controller.save,
          checkNameTaken: controller.checkNameTaken,
          ...(leadHandler === undefined ? {} : { sendLead: leadHandler }),
          onSaved: (saved) => {
            setAnnouncement(
              format(
                saved.scope === "global"
                  ? "chat.toolCall.workflow.saveRun.announce.global"
                  : "chat.toolCall.workflow.saveRun.announce.project",
              ),
            );
            anchorRef.current?.focus();
          },
        }}
        onOpenChange={setPopoverOpen}
        open={popoverOpen}
      />
      <SavedWorkflowLaunchDialog
        entry={launchEntry}
        scope={launchEntry?.scope ?? "project"}
        projectLabel={
          localProjects.find(
            (project) =>
              resolveWorkspaceKey({
                workspacePath: project.workspacePath,
                ...(project.workspaceIdentity
                  ? { workspaceIdentity: project.workspaceIdentity }
                  : {}),
              }) === runProjectKey,
          )?.label ?? host.workspacePath
        }
        {...(controller.runArgs === undefined ? {} : { initialArgs: controller.runArgs })}
        {...(launchEntry?.scope === "global"
          ? { targets: localProjects, defaultTargetKey: runProjectKey }
          : {})}
        pending={controller.launching}
        error={controller.launchError}
        onOpenChange={(open) => (open ? undefined : setLaunchEntry(null))}
        onSubmit={(submitted, args, target) => {
          void controller
            .launch(
              submitted,
              args,
              target === undefined
                ? undefined
                : {
                    projectId: target.projectId,
                    hostId: target.hostId,
                    workspacePath: target.workspacePath,
                    ...(target.workspaceIdentity
                      ? { workspaceIdentity: target.workspaceIdentity }
                      : {}),
                    ...(target.remoteSessionId ? { remoteSessionId: target.remoteSessionId } : {}),
                  },
            )
            .then((result) => {
              if (result.ok) setLaunchEntry(null);
            });
        }}
      />
      {}
      <span className="sr-only" aria-live="polite" data-testid="workflow-save-announcement">
        {announcement}
      </span>
    </>
  );

  return { leading, trailing };
}

export function WorkflowRunSaveSlotsBoundary({
  children,
  host,
}: {
  children: (slots: WorkflowRunSaveSlots | null) => ReactNode;
  host: WorkflowRunSaveSlotsHost;
}) {
  const services = useOptionalServices();
  if (services === null) return <>{children(null)}</>;
  return <WorkflowRunSaveSlotsMount host={host}>{children}</WorkflowRunSaveSlotsMount>;
}

function WorkflowRunSaveSlotsMount({
  children,
  host,
}: {
  children: (slots: WorkflowRunSaveSlots | null) => ReactNode;
  host: WorkflowRunSaveSlotsHost;
}) {
  const slots = useWorkflowRunSaveSlots(host);
  return <>{children(slots)}</>;
}

function WorkflowRunSavedChip({
  entry,
  hint,
  label,
  onOpen,
}: {
  entry: CfSavedWorkflowEntry;
  hint?: string;
  label: string;
  
  onOpen?: () => void;
}) {
  const content = (
    <>
      <CheckIcon aria-hidden className="size-3" />
      {label}
      {onOpen === undefined ? null : (
        <ArrowUpRightIcon
          aria-hidden
          className="hidden size-3 group-hover/saved-chip:block group-focus-visible/saved-chip:block"
        />
      )}
    </>
  );
  const className =
    "group/saved-chip flex shrink-0 items-center gap-1 rounded-full bg-surface py-0.5 pl-1.5 pr-2 text-ui-xs font-medium text-foreground-subtle";
  if (onOpen === undefined) {
    return (
      <span className={className} data-testid="workflow-saved-chip">
        {content}
      </span>
    );
  }
  return (
    <ControlHintTooltip title={hint ?? label} side="top">
      <button
        className={cn(className, "hover:bg-hover hover:text-foreground")}
        data-testid="workflow-saved-chip"
        onClick={onOpen}
        title={entry.name}
        type="button"
      >
        {content}
      </button>
    </ControlHintTooltip>
  );
}
