import { useEffect, useState } from "react";
import { Info, Workflow } from "lucide-react";
import {
  TID_WORKFLOW_LAUNCH_ARG,
  TID_WORKFLOW_LAUNCH_DIALOG,
  TID_WORKFLOW_LAUNCH_ERROR,
  TID_WORKFLOW_LAUNCH_FIELDS,
  TID_WORKFLOW_LAUNCH_SUBMIT,
  TID_WORKFLOW_LAUNCH_TARGET,
  type CfSavedWorkflowEntry,
} from "@origin-ai/cf-shared";
import { testId } from "@origin-ai/cf-shared/test-ids";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { Spinner } from "@/components/ui/spinner.js";
import { Switch } from "@/components/ui/switch.js";
import { cn } from "@/components/lib/utils.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { AutomationRunNowIcon } from "@/settings/AutomationDesignPrimitives.js";
import { SettingsFormTextarea } from "@/settings/SettingsFormTextarea.js";
import {
  findAutomationWorkspaceOptionByKey,
  reconcileAutomationWorkspaceSelectionKey,
  resolveAutomationWorkspaceSelectionKey,
  type AutomationWorkspaceOption,
} from "@/settings/automationWorkspaceOptions.js";
import {
  buildSavedWorkflowArgFields,
  collectSavedWorkflowArgs,
  type SavedWorkflowArgField,
  type SavedWorkflowArgFieldError,
} from "@/settings/saved-workflows/savedWorkflowArgsForm.js";
import type { SavedWorkflowLaunchError } from "@/settings/saved-workflows/useSavedWorkflowLauncher.js";

function workflowArgInputId(name: string): string {
  return `workflow-arg-${name}`;
}

interface SavedWorkflowLaunchDialogProps {
  entry: CfSavedWorkflowEntry | null;
  
  scope: "project" | "global";
  
  projectLabel: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (
    entry: CfSavedWorkflowEntry,
    args: Record<string, unknown>,
    target?: AutomationWorkspaceOption,
  ) => void;
  
  targets?: readonly AutomationWorkspaceOption[];
  
  defaultTargetKey?: string | null;
  
  initialArgs?: Record<string, unknown>;
  
  pending?: boolean;
  
  error?: SavedWorkflowLaunchError | null;
}

export function SavedWorkflowLaunchDialog({
  entry,
  scope,
  projectLabel,
  onOpenChange,
  onSubmit,
  targets,
  defaultTargetKey,
  initialArgs,
  pending = false,
  error = null,
}: SavedWorkflowLaunchDialogProps) {
  const { intl } = useCfIntl();
  const [fields, setFields] = useState<SavedWorkflowArgField[]>([]);
  const [errors, setErrors] = useState<Record<string, SavedWorkflowArgFieldError>>({});
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const [revealRequest, setRevealRequest] = useState<{ name: string } | null>(null);

  useEffect(() => {
    if (!revealRequest) return;
    const control = document.getElementById(workflowArgInputId(revealRequest.name));
    if (!control) return;
    (control.closest("[data-workflow-arg-row]") ?? control).scrollIntoView({ block: "nearest" });
    control.focus({ preventScroll: true });
  }, [revealRequest]);

  useEffect(() => {
    setFields(buildSavedWorkflowArgFields(entry?.args, initialArgs));
    setErrors({});
  }, [entry, initialArgs]);

  useEffect(() => {
    if (!targets) {
      setTargetKey(null);
      return;
    }
    const defaultOption = defaultTargetKey
      ? findAutomationWorkspaceOptionByKey(targets, defaultTargetKey)
      : undefined;
    setTargetKey((current) =>
      reconcileAutomationWorkspaceSelectionKey(targets, current, defaultOption),
    );
  }, [targets, defaultTargetKey]);

  const hasTargets = targets !== undefined;
  const noLocalProject = hasTargets && targets.length === 0;
  const selectedTarget = targets
    ? findAutomationWorkspaceOptionByKey(targets, targetKey)
    : undefined;
  const noteProject = selectedTarget?.label ?? projectLabel;
  const fieldRowCount = fields.length + (hasTargets ? 1 : 0);

  const scopeBadge = intl.formatMessage({
    id:
      scope === "global"
        ? "workflows.hub.launch.scope.global"
        : "workflows.hub.launch.scope.project",
  });

  const updateField = (name: string, value: string) => {
    setFields((current) =>
      current.map((field) => (field.name === name ? { ...field, value } : field)),
    );
    setErrors((current) => {
      if (!(name in current)) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  };

  const handleSubmit = () => {
    if (!entry) return;
    if (noLocalProject || pending) return;
    const collected = collectSavedWorkflowArgs(fields);
    if (!collected.ok) {
      setErrors(collected.errors);
      const firstInvalid = fields.find((field) => field.name in collected.errors);
      if (firstInvalid) setRevealRequest({ name: firstInvalid.name });
      return;
    }
    onSubmit(entry, collected.args, selectedTarget);
  };

  return (
    <Dialog open={entry !== null} onOpenChange={onOpenChange}>
      {}
      <DialogContent
        className="flex max-h-[min(calc(100dvh-2rem),45rem)] flex-col overflow-y-auto sm:max-w-[480px]"
        data-testid={TID_WORKFLOW_LAUNCH_DIALOG}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Workflow className="size-4 shrink-0 text-foreground-subtle" aria-hidden="true" />
            <span className="min-w-0 truncate font-mono">{entry?.name}</span>
            <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-ui-xs font-normal leading-none text-foreground-subtlest">
              {scopeBadge}
            </span>
          </DialogTitle>
          {entry?.description ? (
            <p className="text-ui-sm text-foreground-subtle">{entry.description}</p>
          ) : null}
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
        >
          {fieldRowCount > 0 ? (
            <div
              data-testid={TID_WORKFLOW_LAUNCH_FIELDS}
              className={cn(
                "relative -mx-4 -my-2 flex flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-2",
                fieldRowCount >= 3 ? "min-h-24 flex-1" : "shrink-0",
              )}
            >
              {hasTargets ? (
                <div className="flex shrink-0 flex-col gap-1.5">
                  <span className="text-ui-base font-medium text-foreground">
                    {intl.formatMessage({ id: "workflows.hub.launch.target" })}
                  </span>
                  {noLocalProject ? (
                    <p className="text-ui-sm text-foreground-subtle">
                      {intl.formatMessage({ id: "workflows.hub.launch.noLocalProject" })}
                    </p>
                  ) : (
                    <Select value={targetKey ?? undefined} onValueChange={setTargetKey}>
                      <SelectTrigger data-testid={TID_WORKFLOW_LAUNCH_TARGET}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {targets.map((option) => {
                          const key = resolveAutomationWorkspaceSelectionKey(option);
                          return (
                            <SelectItem key={key} value={key}>
                              {option.label}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              ) : null}
              {fields.map((field) => {
                const fieldError = errors[field.name];
                const inputId = workflowArgInputId(field.name);
                const errorText = fieldError
                  ? intl.formatMessage({ id: `workflows.hub.launch.error.${fieldError}` })
                  : null;
                return (
                  <div
                    key={field.name}
                    data-workflow-arg-row={field.name}
                    className="flex shrink-0 flex-col gap-1.5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <label
                            htmlFor={inputId}
                            className="font-mono text-ui-base font-medium text-foreground"
                          >
                            {field.name}
                          </label>
                          {field.required ? (
                            <span className="rounded-sm border border-border px-1.5 py-0.5 text-ui-xs leading-none text-foreground-subtlest">
                              {intl.formatMessage({ id: "workflows.hub.launch.required" })}
                            </span>
                          ) : null}
                        </div>
                        {field.description ? (
                          <p className="text-ui-sm text-foreground-subtle">{field.description}</p>
                        ) : null}
                      </div>
                      {field.type === "boolean" ? (
                        <Switch
                          id={inputId}
                          data-testid={testId(TID_WORKFLOW_LAUNCH_ARG, field.name)}
                          checked={field.value === "true"}
                          onCheckedChange={(checked) =>
                            updateField(field.name, checked ? "true" : "false")
                          }
                        />
                      ) : null}
                    </div>
                    {field.type === "json" ? (
                      <SettingsFormTextarea
                        id={inputId}
                        data-testid={testId(TID_WORKFLOW_LAUNCH_ARG, field.name)}
                        className={cn("min-h-20 font-mono", fieldError && "border-destructive")}
                        value={field.value}
                        aria-invalid={Boolean(fieldError)}
                        onChange={(event) => updateField(field.name, event.target.value)}
                      />
                    ) : field.type === "boolean" ? null : (
                      <Input
                        id={inputId}
                        data-testid={testId(TID_WORKFLOW_LAUNCH_ARG, field.name)}
                        type={field.type === "number" ? "number" : "text"}
                        inputMode={field.type === "number" ? "decimal" : undefined}
                        className={cn("font-mono", fieldError && "border-destructive")}
                        value={field.value}
                        aria-invalid={Boolean(fieldError)}
                        onChange={(event) => updateField(field.name, event.target.value)}
                      />
                    )}
                    {errorText ? <p className="text-ui-sm text-destructive">{errorText}</p> : null}
                  </div>
                );
              })}
            </div>
          ) : null}
          <div className="flex shrink-0 flex-col gap-4">
            <div className="flex items-start gap-2 rounded-lg bg-surface px-3 py-2.5 text-ui-base text-foreground-subtle">
              <span className="flex size-5 shrink-0 items-center justify-center">
                <Info className="size-4" aria-hidden="true" />
              </span>
              <p className="min-w-0 leading-5">
                {intl.formatMessage({ id: "workflows.hub.launch.note" }, { project: noteProject })}
              </p>
            </div>
            {error ? (
              <div
                data-testid={TID_WORKFLOW_LAUNCH_ERROR}
                className="flex flex-col gap-1.5 rounded-lg border border-destructive/40 px-3 py-2.5"
              >
                <p className="text-ui-sm font-medium text-destructive">
                  {intl.formatMessage({ id: `workflows.hub.launch.error.${error.reason}` })}
                </p>
                {error.message ? (
                  <pre className="max-h-40 min-w-0 overflow-auto whitespace-pre-wrap break-words font-mono text-ui-sm text-foreground-subtle">
                    {error.message}
                  </pre>
                ) : null}
              </div>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={pending}
                onClick={() => onOpenChange(false)}
              >
                {intl.formatMessage({ id: "workflows.hub.launch.cancel" })}
              </Button>
              <Button
                type="submit"
                size="lg"
                data-icon="inline-start"
                data-testid={TID_WORKFLOW_LAUNCH_SUBMIT}
                disabled={noLocalProject || pending}
              >
                {pending ? (
                  <Spinner className="size-4" />
                ) : (
                  <AutomationRunNowIcon className="size-4" aria-hidden="true" />
                )}
                {intl.formatMessage({ id: "workflows.hub.launch.submit" })}
              </Button>
            </DialogFooter>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
