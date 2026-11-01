
import { serializeWorkflowArtifact } from "@origin-ai/cf-contracts";

export { serializeWorkflowArtifact };

const WORKFLOW_REPORTS_PREVIEW_MAX_CHARS = 8_000;

const WORKFLOW_REPORT_ITEM_MAX_CHARS = 2_000;

interface WorkflowReportsNotificationSection {
  
  count: number;
  
  shown: number;
  preview: string;
}

export function buildWorkflowReportsNotificationSection(
  items: readonly unknown[] | undefined,
  total?: number,
): WorkflowReportsNotificationSection | undefined {
  if (items === undefined || items.length === 0) return undefined;

  const lines: string[] = [];
  let used = 0;
  for (const [index, item] of items.entries()) {
    const text = clip(serializeWorkflowArtifact(item) ?? "", WORKFLOW_REPORT_ITEM_MAX_CHARS);
    const line = `[${index + 1}] ${text}`;
    if (lines.length > 0 && used + line.length + 1 > WORKFLOW_REPORTS_PREVIEW_MAX_CHARS) break;
    lines.push(line);
    used += line.length + 1;
  }

  return {
    count: Math.max(total ?? 0, items.length),
    shown: lines.length,
    preview: lines.join("\n"),
  };
}

export function buildWorkflowReportsManifestSection(
  items: readonly unknown[] | undefined,
  total?: number,
): { count: number; shown: number; preview: string[] } | undefined {
  if (items === undefined || items.length === 0) return undefined;

  const preview: string[] = [];
  for (const item of items) {
    if (preview.length >= WORKFLOW_NOTIFICATION_REPORTS_MAX_ITEMS) break;
    preview.push(clip(serializeWorkflowArtifact(item) ?? "", WORKFLOW_NOTIFICATION_REPORT_ITEM_MAX_CHARS));
  }
  return { count: Math.max(total ?? 0, items.length), shown: preview.length, preview };
}

const WORKFLOW_NOTIFICATION_REPORT_ITEM_MAX_CHARS = 500;

const WORKFLOW_NOTIFICATION_REPORTS_MAX_ITEMS = 8;

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

