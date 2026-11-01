// ============================================================
// ============================================================
//

import { useCallback, useState } from "react";
import type { CfPermissionOption } from "@origin-ai/cf-shared";
import type { WorkflowAskSettingsContent } from "@/components/workflow-timeline/workflowAskSettings.js";
import { getPermissionOptionDisplayKind } from "@/lib/permissionRequest.js";

export const WORKFLOW_PERMISSION_SETTINGS_SELECTOR = '[data-testid="workflow-permission-settings"]';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function usePermissionWorkflowSettings(requestId: string) {
  const [content, setContent] = useState<{
    requestId: string;
    value: WorkflowAskSettingsContent | undefined;
  } | null>(null);
  const [blocked, setBlocked] = useState<{ requestId: string; value: boolean } | null>(null);
  const onContentChange = useCallback(
    (value: WorkflowAskSettingsContent | undefined) => setContent({ requestId, value }),
    [requestId],
  );
  const onBlockedChange = useCallback(
    (value: boolean) => setBlocked({ requestId, value }),
    [requestId],
  );
  return {
    content: content?.requestId === requestId ? content.value : undefined,
    blocked: blocked?.requestId === requestId && blocked.value,
    onBlockedChange,
    onContentChange,
  };
}

export function isWorkflowSettingsCarrier(option: CfPermissionOption): boolean {
  const kind = getPermissionOptionDisplayKind(option.kind);
  return kind === "allowOnce" || kind === "allowAlways";
}

export function workflowAdjustedOptionDescriptionId(messageId: string | null): string | null {
  switch (messageId) {
    case "chat.permission.allowOnce.description":
      return "chat.permission.workflow.allowOnce.adjusted";
    case "chat.permission.workflow.allowForSession.description":
      return "chat.permission.workflow.allowForSession.adjusted";
    default:
      return messageId;
  }
}

export function focusLastWorkflowSettingsControl(root: HTMLElement | null): boolean {
  const block = root?.querySelector<HTMLElement>(WORKFLOW_PERMISSION_SETTINGS_SELECTOR);
  const controls = block?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  const last = controls === undefined ? undefined : controls[controls.length - 1];
  if (last === undefined) return false;
  last.focus();
  return true;
}
