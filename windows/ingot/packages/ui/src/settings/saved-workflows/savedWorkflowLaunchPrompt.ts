
function isZh(locale: string): boolean {
  return locale.toLowerCase().startsWith("zh");
}

export function buildSavedWorkflowRevisePrompt(input: {
  name: string;
  path: string;
  locale: string;
  scope?: "project" | "global";
}): string {
  const globalReminderZh =
    input.scope === "global" ? 'It is a global workflow. Keep scope: "global" when saving.' : "";
  const globalReminderEn =
    input.scope === "global" ? 'It is a global workflow; keep scope: "global" when saving. ' : "";
  return isZh(input.locale)
    ? `请修订Saved Workflows「${input.name}」（${input.path}）：${globalReminderZh}`
    : `Please revise the saved workflow "${input.name}" (${input.path}): ${globalReminderEn}`;
}

export function buildSavedWorkflowCreatePrompt(
  locale: string,
  scope?: "project" | "global",
): string {
  if (scope === "global") {
    return isZh(locale)
      ? 'Help me design a workflow, and once verified, save it as a global workflow using SaveWorkflow (scope: "global"):'
      : 'Help me design a workflow and save it as a global workflow (scope: "global") with SaveWorkflow once it works: ';
  }
  return isZh(locale)
    ? "Help me design a workflow, verify that it runs successfully, and save it to this project:"
    : "Help me design a workflow and save it to this project once it works: ";
}

export function buildSavedWorkflowPromotePrompt(input: {
  name: string;
  path: string;
  locale: string;
}): string {
  if (isZh(input.locale)) {
    return [
      `请把已Save的ProjectWorkflow「${input.name}」（${input.path}）Promote to GlobalWorkflow。全局Workflow对All projects可见、在任何Project里都能Run，所以它不能依赖本仓库的任何东西。请按下面的Steps做：`,
      "1. 读取这个文件，理解它的因果结构（哪些子代理、什么顺序、什么交接）。",
      "2. 找出所有引用本仓库的地方：具体路径、命令、目录结构、命名约定、分支名等。",
      "3. Extract them into `args` declarations (with descriptions and reasonable defaults), or rewrite them into project-agnostic neutral descriptions, while keeping the causal structure intact.",
      '4. 用 SaveWorkflow 以 scope: "global" 保存。名字可以沿用，也可以取一个更贴切的名字。不要改动原来的项目工作流文件。',
      "5. Finally, summarize in a few sentences what was generalized and what points were extracted into parameters.",
      "如果这个工作流本质上就绑定在这个项目上、无法有意义地概括，请说明原因并停下，不要保存。",
    ].join("\n");
  }
  return [
    `Promote the saved project workflow "${input.name}" (${input.path}) to a global workflow. Global workflows are visible to every project and can run from any of them, so it must not depend on anything in this repository. Follow these steps:`,
    "1. Read the file and understand its causal structure (which subagents, in what order, with what hand-offs).",
    "2. Find everything that refers to this repository: concrete paths, commands, directory layout, naming conventions, branch names, and so on.",
    "3. Lift those into `args` declarations (with descriptions and sensible defaults) or rewrite them in project-neutral terms, keeping the causal structure intact.",
    '4. Save it with SaveWorkflow using scope: "global". Keep the name or pick a better one. Do not modify the original project workflow file.',
    "5. Finish with a short summary of what you generalized and which points became arguments.",
    "If the workflow is inherently bound to this project and cannot be generalized meaningfully, say why and stop without saving.",
  ].join("\n");
}
