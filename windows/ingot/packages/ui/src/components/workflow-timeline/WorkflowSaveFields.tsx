//
import type { RefObject } from "react";
import { FolderIcon, GlobeIcon } from "lucide-react";
import type { CfSavedWorkflowScope } from "@origin-ai/cf-shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { Spinner } from "@/components/ui/spinner.js";
import { cn } from "@/components/lib/utils.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { SettingsFormTextarea } from "@/settings/SettingsFormTextarea.js";
import { SAVED_WORKFLOW_NAME_MAX_CHARS, type WorkflowSaveDraft } from "./workflowRunSave.js";

export interface WorkflowSaveFailure {
  reason: string;
  detail?: string;
}

export function WorkflowSaveFields({
  draft,
  failure,
  nameInvalid,
  nameRef,
  onDirectSave,
  pathPreview,
  saving,
  scopeLocked,
  shadowing,
  showDivider,
  submitDisabled,
  submitLabel,
  taken,
  update,
}: {
  draft: WorkflowSaveDraft;
  failure: WorkflowSaveFailure | undefined;
  nameInvalid: boolean;
  nameRef: RefObject<HTMLInputElement | null>;
  onDirectSave: () => void;
  pathPreview: string;
  saving: boolean;
  scopeLocked: boolean;
  
  shadowing: boolean;
  showDivider: boolean;
  submitDisabled: boolean;
  submitLabel: string;
  taken: boolean;
  update: (next: Partial<WorkflowSaveDraft>) => void;
}) {
  const { intl } = useCfIntl();
  const format = (id: string, values?: Record<string, string>) =>
    intl.formatMessage({ id }, values);
  return (
    <>
      {showDivider ? (
        <div className="flex items-center gap-2 text-ui-xs text-foreground-subtlest">
          <span aria-hidden className="h-px flex-1 bg-border" />
          <span>{format("chat.toolCall.workflow.saveRun.or")}</span>
          <span aria-hidden className="h-px flex-1 bg-border" />
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <label className="text-ui-sm text-foreground-subtle" htmlFor="workflow-save-name">
          {format("chat.toolCall.workflow.saveRun.name")}
        </label>
        <div className="relative">
          <Input
            aria-invalid={nameInvalid}
            className="pr-16 font-mono"
            data-testid="workflow-save-name"
            disabled={saving}
            id="workflow-save-name"
            maxLength={SAVED_WORKFLOW_NAME_MAX_CHARS}
            onChange={(event) => update({ name: event.target.value })}
            placeholder={format("chat.toolCall.workflow.saveRun.name.placeholder")}
            ref={nameRef}
            value={draft.name}
          />
          {}
          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center font-mono text-ui-xs text-foreground-subtlest">
            .dwf.ts
          </span>
        </div>
        <p
          className={cn(
            "text-ui-xs",
            nameInvalid ? "text-destructive" : "text-foreground-subtlest",
          )}
          data-testid="workflow-save-name-helper"
        >
          {format(
            nameInvalid
              ? "chat.toolCall.workflow.saveRun.name.invalid"
              : "chat.toolCall.workflow.saveRun.name.helper",
          )}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-ui-sm text-foreground-subtle">
          {format("chat.toolCall.workflow.save.scope.label")}
        </span>
        <Select
          disabled={scopeLocked || saving}
          onValueChange={(value) => update({ scope: value as CfSavedWorkflowScope })}
          value={draft.scope}
        >
          <SelectTrigger className="w-full" data-testid="workflow-save-scope">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {}
            <SelectItem value="project">
              <FolderIcon aria-hidden className="size-3.5 text-foreground-subtle" />
              {format("chat.toolCall.workflow.save.scope.project")}
            </SelectItem>
            <SelectItem value="global">
              <GlobeIcon aria-hidden className="size-3.5 text-foreground-subtle" />
              {format("chat.toolCall.workflow.save.scope.global")}
            </SelectItem>
          </SelectContent>
        </Select>
        {scopeLocked ? (
          <p className="text-ui-xs text-foreground-subtlest">
            {format("chat.toolCall.workflow.saveRun.scope.remoteOnly")}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-ui-sm text-foreground-subtle" htmlFor="workflow-save-description">
          {format("chat.toolCall.workflow.saveRun.description")}
        </label>
        <SettingsFormTextarea
          className="min-h-14"
          data-testid="workflow-save-description"
          disabled={saving}
          id="workflow-save-description"
          onChange={(event) => update({ description: event.target.value })}
          value={draft.description}
        />
        <p className="text-ui-xs text-foreground-subtlest">
          {format("chat.toolCall.workflow.saveRun.description.helper")}
        </p>
      </div>
      <WorkflowSaveConsequence
        failure={failure}
        pathPreview={pathPreview}
        scope={draft.scope}
        shadowing={shadowing}
        taken={taken}
      />
      <div className="flex justify-end">
        <Button
          data-testid="workflow-save-submit"
          disabled={submitDisabled}
          onClick={onDirectSave}
          type="button"
          variant="outline"
        >
          {saving ? <Spinner className="size-3.5" /> : null}
          {submitLabel}
        </Button>
      </div>
    </>
  );
}

function WorkflowSaveConsequence({
  failure,
  pathPreview,
  scope,
  shadowing,
  taken,
}: {
  failure: WorkflowSaveFailure | undefined;
  pathPreview: string;
  scope: CfSavedWorkflowScope;
  shadowing: boolean;
  taken: boolean;
}) {
  const { intl } = useCfIntl();
  const format = (id: string, values?: Record<string, string>) =>
    intl.formatMessage({ id }, values);
  const shadowingText = shadowing
    ? format("chat.toolCall.workflow.saveRun.shadowing", {
        text: format(
          scope === "global"
            ? "chat.toolCall.workflow.save.scope.hiddenByProject"
            : "chat.toolCall.workflow.save.scope.hidesGlobal",
        ),
      })
    : null;
  if (failure !== undefined) {
    return (
      <div className="text-ui-xs text-warning" data-testid="workflow-save-failure" role="status">
        <span>{format(`chat.toolCall.workflow.saveRun.error.${failure.reason}`)}</span>
        {failure.detail === undefined ? null : (
          <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-ui-xs text-foreground-subtle">
            {failure.detail}
          </pre>
        )}
      </div>
    );
  }
  if (taken) {
    return (
      <div
        className="rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-2 text-ui-sm leading-snug text-foreground-subtle"
        data-testid="workflow-save-overwrite"
      >
        {format("chat.toolCall.workflow.saveRun.overwrite")}
        {shadowingText === null ? null : ` ${shadowingText}`}
      </div>
    );
  }
  const [before, after = ""] = format("chat.toolCall.workflow.saveRun.consequence", {
    path: PATH_SLOT,
  }).split(PATH_SLOT);
  return (
    <p
      className="text-ui-sm leading-snug text-foreground-subtle"
      data-testid="workflow-save-consequence"
    >
      {before}
      <code className="font-mono text-ui-xs">{pathPreview}</code>
      {after}
      {shadowingText === null ? null : ` ${shadowingText}`}
    </p>
  );
}

const PATH_SLOT = "\u0000";
