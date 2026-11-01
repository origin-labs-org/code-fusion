import type { Locale, SkillScope } from "@origin-ai/cf-shared";

interface SkillDisplayCandidate {
  name: string;
  description: string;
  path: string;
  scope: SkillScope;
  pluginName?: string;
}

const OFFICIAL_BUILTIN_PLUGIN_NAMES = new Set([
  "android-emulator",
  "browser",
  "browser-use",
  "document-skills",
  "documents",
  "pdf",
  "presentations",
  "spreadsheets",
  "ios-simulator",
  "restore-legacy-sessions",
  "skill-creator",
  "plugin-creator",
  "superpowers",
  "cf-guide",
]);

const OFFICIAL_PLUGIN_PATH_MARKERS = [
  "/cf-plugins-official/",
  "\\cf-plugins-official\\",
  "/android-emulator-plugin/",
  "/browser-use-plugin/",
  "/document-skills-plugin/",
  "/documents-plugin/",
  "/pdf-plugin/",
  "/presentations-plugin/",
  "/spreadsheets-plugin/",
  "/ios-simulator-plugin/",
  "/restore-legacy-sessions-plugin/",
  "/skill-creator-plugin/",
  "/plugin-creator-plugin/",
  "/superpowers-plugin/",
  "/cf-guide-plugin/",
];

const BUILTIN_SKILL_DESCRIPTIONS: Record<string, Record<Locale, string>> = {
  "android-dev": {
    "zh-CN": "Build, run, inspect, and lightly automate Android apps via the android-emulator MCP tool.",
    "en-US": "Build, run, inspect, and lightly automate Android apps through the android-emulator MCP tools.",
  },
  "brainstorming": {
    "zh-CN": "在任何创造性工作前使用：创建功能、构建组件、增加能力或修改行为；先探索用户意图、需求和设计。",
    "en-US": "Use before any creative work, including creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements, and design before implementation.",
  },
  "control-browser": {
    "zh-CN": "Control the CodeFusion built-in browser to open, inspect, click, type, screenshot, or verify web pages and local development pages.",
    "en-US": "Control CodeFusion's built-in browser to open, inspect, click, type, screenshot, or verify webpages and local development targets.",
  },
  "dispatching-parallel-agents": {
    "zh-CN": "Use when facing 2 or more independent tasks with no shared state or sequential dependencies.",
    "en-US": "Use when facing 2+ independent tasks that can be worked on without shared state or sequential dependencies.",
  },
  "docx": {
    "zh-CN": "Complete DOCX document creation, editing, and analysis capabilities, supporting revisions, comments, formatting preservation, and text extraction. Suitable for creating new documents, modifying content, handling revisions, adding comments, or other professional Word document tasks.",
    "en-US": "Create, edit, and analyze DOCX documents with revisions, comments, formatting preservation, and text extraction. Use for new documents, edits, revision handling, comments, and professional Word document work.",
  },
  "docx-viewer": {
    "zh-CN": "View and discuss .docx files with users in the Word document sidebar. Suitable for opening, reading, reviewing, or querying Word documents in the workspace, when users mention content selected or referenced in the viewer, or when newly generated documents need inspection.",
    "en-US": "View and discuss Word (.docx) files with the user in the Documents side panel. Use to open, read, review, or ask about a workspace Word document, when the user refers to a selection or reference in the viewer, or to check a document you just produced.",
  },
  "executing-plans": {
    "zh-CN": "已有书面实现计划，并要在带评审检查点的独立会话中执行时使用。",
    "en-US": "Use when you have a written implementation plan to execute in a separate session with review checkpoints.",
  },
  "finishing-a-development-branch": {
    "zh-CN": "Use when implementation is complete, tests pass, and decisions are needed on merging, creating a PR, or cleaning up branches.",
    "en-US": "Use when implementation is complete, tests pass, and you need to decide how to integrate the work through merge, PR, or cleanup.",
  },
  "ios-dev": {
    "zh-CN": "Build, run, inspect, and lightly automate iOS simulator apps via the ios-simulator MCP tool.",
    "en-US": "Build, run, inspect, and lightly automate iOS Simulator apps through the ios-simulator MCP tools.",
  },
  "pdf": {
    "zh-CN": "Professional PDF toolset covering four pipelines: reports, creative visuals, academic LaTeX, and existing PDF processing. Automatically routes by document type, supporting reports, posters, papers, resumes, extraction, merging, splitting, form filling, and format conversion.",
    "en-US": "Professional PDF toolkit for reports, creative visuals, academic LaTeX, and existing-PDF workflows. Supports reports, posters, papers, resumes, extraction, merge, split, forms, and conversion.",
  },
  "pdf-viewer": {
    "zh-CN": "View and discuss PDF files with users in the PDF sidebar. Suitable for opening, reading, reviewing, or querying PDFs in the workspace, when users mention content selected or referenced in the viewer, or when newly generated PDFs need inspection.",
    "en-US": "View and discuss PDF files with the user in the PDF side panel. Use to open, read, review, or ask about a workspace PDF, when the user refers to a selection or reference in the viewer, or to check a PDF you just produced.",
  },
  "pptx": {
    "zh-CN": "Inspect and narrowly update elements selected from the PPTX preview area. Validates shape text or table cells via full file fingerprint and OOXML targeting, halting on conflicts without guessing.",
    "en-US": "Inspect and narrowly update elements selected in PPTX Preview Pane. Verifies the whole-file fingerprint and OOXML locator for shape or table-cell text, and stops on conflicts instead of guessing.",
  },
  "pptx-viewer": {
    "zh-CN": "View and discuss .pptx presentations with users in the presentation sidebar. Suitable for opening, reviewing, or querying presentations in the workspace together, when users mention slides or elements selected or referenced in the viewer, or when newly generated presentations need inspection.",
    "en-US": "View and discuss PowerPoint (.pptx) decks with the user in the Presentations side panel. Use to open, review, or ask about a workspace deck together, when the user refers to a slide or shape selected or referenced in the viewer, or to check a deck you just produced.",
  },
  "receiving-code-review": {
    "zh-CN": "收到代码评审反馈、准备实现建议前使用；尤其当反馈不清楚或技术上可疑时，需要严谨验证而非盲目同意。",
    "en-US": "Use when receiving code review feedback before implementing suggestions, especially when feedback is unclear or technically questionable.",
  },
  "requesting-code-review": {
    "zh-CN": "Use to request a code review to confirm requirements are met before completing tasks, implementing major features, or merging.",
    "en-US": "Use when completing tasks, implementing major features, or before merging to verify work meets requirements.",
  },
  "restore-legacy-sessions": {
    "zh-CN": "Inspect, plan, or execute restoring legacy ACP-era CodeFusion sessions into the new CodeFusion task and session store.",
    "en-US": "Inspect, plan, or restore old ACP-era CodeFusion sessions into the new CodeFusion task and session stores.",
  },
  "plugin-creator": {
    "zh-CN": "创建、校验 CodeFusion 插件，并指导本地安装与更新。",
    "en-US": "Create and validate CodeFusion plugins, and guide local installation and updates.",
  },
  "skill-creator": {
    "zh-CN": "Create new skills, edit existing skills, and iterate on phrasing. Suitable for authoring SKILL.md from scratch, improving existing skills, distilling repetitive workflows into reusable skills, or optimizing skill descriptions to improve trigger reliability.",
    "en-US": "Create new skills, edit existing skills, and iterate wording. Use for writing SKILL.md from scratch, improving skills, capturing repeated workflows, or tuning descriptions for reliable triggering.",
  },
  "subagent-driven-development": {
    "zh-CN": "Use when executing an implementation plan containing independent tasks within the current session.",
    "en-US": "Use when executing implementation plans with independent tasks in the current session.",
  },
  "systematic-debugging": {
    "zh-CN": "Use when encountering any bug, test failure, or abnormal behavior before proposing a fix.",
    "en-US": "Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes.",
  },
  "test-driven-development": {
    "zh-CN": "Use before writing implementation code when implementing any feature or bugfix.",
    "en-US": "Use when implementing any feature or bugfix, before writing implementation code.",
  },
  "using-git-worktrees": {
    "zh-CN": "Use before starting isolated feature work or executing an implementation plan to ensure an isolated workspace exists, prioritizing native tools or falling back to git worktree.",
    "en-US": "Use when starting feature work that needs isolation or before executing implementation plans. Ensures an isolated workspace exists via native tools or git worktree fallback.",
  },
  "using-superpowers": {
    "zh-CN": "Use when starting any conversation; explains how to find and use skills, and requires calling Skill tools before any response, including clarifying questions.",
    "en-US": "Use when starting any conversation. Establishes how to find and use skills, requiring Skill tool invocation before any response including clarifying questions.",
  },
  "verification-before-completion": {
    "zh-CN": "Use before claiming work is complete, fixed, or tests pass; requires running verification commands and confirming outputs first, establishing evidence before drawing conclusions.",
    "en-US": "Use before claiming work is complete, fixed, or passing. Requires running verification commands and confirming output before success claims.",
  },
  "web-gui-tester": {
    "zh-CN": "Use CodeFusion Browser Use to perform pure GUI black-box testing on web pages and local web frontends, verifying functionality, interactions, and responsive layouts via real user interactions, DOM semantic evidence, and screenshots.",
    "en-US": "Run pure GUI black-box tests against websites and local web frontends with CodeFusion Browser Use, combining real user interactions, semantic DOM evidence, and inspected screenshots.",
  },
  "writing-plans": {
    "zh-CN": "Use to write an implementation plan before modifying code when specifications or multi-step task requirements already exist.",
    "en-US": "Use when you have a spec or requirements for a multi-step task, before touching code.",
  },
  "writing-skills": {
    "zh-CN": "Use when creating new skills, editing existing skills, or verifying if skills work before publishing.",
    "en-US": "Use when creating new skills, editing existing skills, or verifying skills work before deployment.",
  },
  "xlsx-viewer": {
    "zh-CN": "View and discuss .xlsx workbooks with users in the spreadsheet sidebar. Suitable for opening, browsing, or querying workbooks in the workspace together, when users mention cells selected or referenced in the viewer, or when newly generated workbooks need inspection.",
    "en-US": "View and discuss Excel (.xlsx) workbooks with the user in the Spreadsheets side panel. Use to open, browse, or ask about a workspace workbook together, when the user refers to cells selected or referenced in the viewer, or to check a workbook you just produced.",
  },
};

export function resolveSkillSourceLabel(scope: SkillScope, locale?: Locale): string {
  if (locale === "zh-CN") {
    if (scope === "workspace") return "工作区";
    if (scope === "plugin") return "插件";
    return "用户";
  }
  if (scope === "workspace") return "Workspace";
  if (scope === "plugin") return "Plugin";
  return "User";
}

export function resolveSkillDisplayDescription(
  skill: SkillDisplayCandidate,
  locale?: Locale,
): string {
  const localized = isOfficialBuiltinSkill(skill)
    ? BUILTIN_SKILL_DESCRIPTIONS[skill.name]?.[locale ?? "en-US"]
    : undefined;
  return localized ?? skill.description;
}

function isOfficialBuiltinSkill(skill: SkillDisplayCandidate): boolean {
  if (skill.scope !== "plugin") {
    return false;
  }
  const pluginName = skill.pluginName?.trim();
  if (pluginName && OFFICIAL_BUILTIN_PLUGIN_NAMES.has(pluginName)) {
    return true;
  }
  const normalizedPath = skill.path.replaceAll("\\", "/");
  return OFFICIAL_PLUGIN_PATH_MARKERS.some((marker) => normalizedPath.includes(marker));
}
