//
import type { CfSavedWorkflowScope } from "@origin-ai/cf-shared";

const SAVED_WORKFLOW_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/u;
export const SAVED_WORKFLOW_NAME_MAX_CHARS = 64;

export function isValidSavedWorkflowNameText(name: string): boolean {
  if (name.length === 0 || name.length > SAVED_WORKFLOW_NAME_MAX_CHARS) return false;
  if (!SAVED_WORKFLOW_NAME_PATTERN.test(name)) return false;
  return name.replaceAll(".", "").length > 0;
}

export function savedWorkflowPathPreview(scope: CfSavedWorkflowScope, name: string): string {
  const file = `${name}.dwf.ts`;
  return scope === "global" ? `~/.cf/workflows/${file}` : `.cf/workflows/${file}`;
}

export interface WorkflowSaveDraft {
  name: string;
  scope: CfSavedWorkflowScope;
  description: string;
}

export function initialWorkflowSaveDraft(input: {
  runName?: string;
  scope?: CfSavedWorkflowScope;
}): WorkflowSaveDraft {
  const runName = input.runName?.trim() ?? "";
  return {
    name: isValidSavedWorkflowNameText(runName) ? runName : "",
    scope: input.scope ?? "project",
    description: runName,
  };
}

function isZh(locale: string): boolean {
  return locale.toLowerCase().startsWith("zh");
}

export function buildWorkflowSaveRequestPrompt(input: {
  locale: string;
  runId: string;
  runName?: string;
  name: string;
  scope: CfSavedWorkflowScope;
  description: string;
}): string {
  const name = input.name.trim();
  const description = input.description.trim();
  const runName = input.runName?.trim();
  if (isZh(input.locale)) {
    const target =
      input.scope === "global" ? '保存为全局工作流（scope: "global"）' : "保存到本项目";
    return [
      `请把刚Run完的Workflow${runName ? `「${runName}」` : ""}提炼成可以复用的Workflow，用 SaveWorkflow ${target}：`,
      "1. 脚本以这次运行实际执行的那一份为准，不要改动它的逻辑。",
      "2. 把两次运行之间会变化的值抽成 args（写好说明与合理默认值），并补齐 description 与 whenToUse。",
      name.length > 0 ? `3. 名Character用 \`${name}\`。` : "3. 名字请你来取（只能用字母、数字和 - _ .）。",
      description.length > 0 ? `4. Description可以参考：${description}` : "",
      `5. 调用 SaveWorkflow 时带上 run_id: "${input.runId}"——这次Run要据此认出自己已被Save。`,
    ]
      .filter((line) => line.length > 0)
      .join("\n");
  }
  const target =
    input.scope === "global"
      ? 'save it as a global workflow (scope: "global")'
      : "save it to this project";
  return [
    `Please distill the workflow that just finished${runName ? ` ("${runName}")` : ""} into a reusable one and ${target} with SaveWorkflow:`,
    "1. Use the script this run actually executed; do not change its logic.",
    "2. Lift the values that change between runs into args (with descriptions and sensible defaults), and write description and whenToUse.",
    name.length > 0
      ? `3. Name it \`${name}\`.`
      : "3. Pick the name yourself (letters, digits and - _ . only).",
    description.length > 0 ? `4. For the description, start from: ${description}` : "",
    `5. Pass run_id: "${input.runId}" to SaveWorkflow, so that run can tell it has been saved.`,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}
