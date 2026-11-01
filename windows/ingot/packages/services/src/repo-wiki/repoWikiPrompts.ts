import type { RepoWikiPageKind } from "@origin-ai/cf-shared";
import type { RepoScanModule, RepoScanResult } from "./repoScanner.js";

export interface RepoWikiPagePlan {
  slug: string;
  title: string;
  kind: RepoWikiPageKind;
  order: number;
  modulePath?: string;
  sourcePaths: string[];
}

const MAX_MODULES = 12;

const SHARED_RULES = [
  "You are writing a repository wiki page for developers who have never opened this codebase.",
  "Use only the repository evidence provided in this prompt. Never invent files, commands, APIs or behavior.",
  "Reference concrete files as inline code paths, for example `src/app.ts`.",
  "If the evidence is insufficient for a claim, omit the claim instead of guessing.",
  "Return GitHub-flavored Markdown only: no preamble, no closing summary, no surrounding code fence.",
  "Start with a single level-1 heading and use level-2/level-3 headings for structure.",
  "Keep the page focused: 300-700 words unless the evidence clearly requires more.",
].join("\n");

export function planRepoWikiPages(scan: RepoScanResult): RepoWikiPagePlan[] {
  const modules = scan.modules.filter((module) => module.path !== "(root)").slice(0, MAX_MODULES);
  const pages: RepoWikiPagePlan[] = [
    {
      slug: "overview",
      title: "Project Overview",
      kind: "overview",
      order: 0,
      sourcePaths: scan.excerpts.slice(0, 8).map((excerpt) => excerpt.relativePath),
    },
    {
      slug: "architecture",
      title: "Architecture",
      kind: "architecture",
      order: 1,
      sourcePaths: scan.excerpts.slice(0, 12).map((excerpt) => excerpt.relativePath),
    },
    {
      slug: "tech-stack",
      title: "Tech Stack",
      kind: "tech-stack",
      order: 2,
      sourcePaths: scan.excerpts
        .filter((excerpt) => /package\.json|pyproject|Cargo\.toml|go\.mod|CMakeLists|Dockerfile/.test(excerpt.relativePath))
        .map((excerpt) => excerpt.relativePath)
        .slice(0, 8),
    },
    {
      slug: "conventions",
      title: "Coding Conventions",
      kind: "conventions",
      order: 3,
      sourcePaths: scan.excerpts.slice(0, 12).map((excerpt) => excerpt.relativePath),
    },
  ];

  modules.forEach((module, index) => {
    pages.push({
      slug: `modules/${toSlug(module.path)}`,
      title: `Module: ${module.name}`,
      kind: "module",
      order: 10 + index,
      modulePath: module.path,
      sourcePaths: module.samplePaths,
    });
  });

  return pages;
}

export function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "module";
}

export function buildRepoDigest(scan: RepoScanResult): string {
  const moduleLines = scan.modules
    .slice(0, 24)
    .map((module) => `- ${module.path} (${module.fileCount} files): ${module.samplePaths.join(", ")}`);
  const languageLines = scan.languages
    .slice(0, 12)
    .map((entry) => `- ${entry.language}: ${entry.files} files`);
  const excerptBlocks = scan.excerpts.map((excerpt) => {
    const suffix = excerpt.truncated ? "\n… (truncated)" : "";
    return `### File: ${excerpt.relativePath}\n\`\`\`\n${excerpt.content}${suffix}\n\`\`\``;
  });

  return [
    `# Repository: ${scan.projectName}`,
    "",
    `Files scanned: ${scan.files.length} (${scan.totalBytes} bytes)`,
    `Root entries: ${scan.rootEntries.slice(0, 40).join(", ")}`,
    "",
    "## Languages",
    languageLines.join("\n") || "- (none detected)",
    "",
    "## Top-level modules",
    moduleLines.join("\n") || "- (single-module repository)",
    "",
    "## Representative file contents",
    excerptBlocks.join("\n\n"),
  ].join("\n");
}

export function buildRepoWikiPagePrompt(params: {
  plan: RepoWikiPagePlan;
  module?: RepoScanModule;
  scan: RepoScanResult;
  language: string;
}): string {
  const { plan, module, scan, language } = params;
  const digest = buildRepoDigest(scan);
  const languageRule =
    language === "en" ? "Write the page in English." : `Write the page in locale "${language}".`;

  return [
    SHARED_RULES,
    languageRule,
    "",
    `Page kind: ${plan.kind}`,
    `Page title: ${plan.title}`,
    module ? `Module under focus: ${module.path}` : "",
    "",
    "Page-specific requirements:",
    pageRequirements(plan, module),
    "",
    "Repository evidence:",
    digest,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function pageRequirements(plan: RepoWikiPagePlan, module?: RepoScanModule): string {
  switch (plan.kind) {
    case "overview":
      return [
        "- Explain what this project is and the problem it solves.",
        "- List the main user-facing capabilities, each tied to the files that implement them.",
        "- Describe how the pieces fit together at a high level.",
        "- Include a short 'Getting started' section only when the evidence shows concrete scripts or commands.",
      ].join("\n");
    case "architecture":
      return [
        "- Map the major modules/layers and their responsibilities.",
        "- Describe the primary data or control flow between them.",
        "- Point out extension points and the boundaries that are safe to change.",
        "- Call out entry points (CLI, server, UI bootstrap) with their file paths.",
      ].join("\n");
    case "tech-stack":
      return [
        "- Enumerate languages, frameworks, runtimes and build/test/lint tooling that the files prove.",
        "- Quote the exact scripts or config keys that establish each tool.",
        "- Note version pins and workspace layout only when visible in the evidence.",
      ].join("\n");
    case "conventions":
      return [
        "- Describe naming, file layout, module boundaries and error-handling patterns observable in the code.",
        "- Describe testing strategy and where tests live.",
        "- Describe comment/documentation conventions.",
        "- Do not prescribe new rules; report what the repository already does.",
      ].join("\n");
    case "module":
      return [
        `- Explain the responsibility of the \`${module?.path ?? plan.modulePath}\` module.`,
        "- List its key files and what each one owns.",
        "- Describe its public surface and dependencies on other modules.",
        "- Explain how to extend it safely.",
      ].join("\n");
    default:
      return "- Document the subject using only the repository evidence.";
  }
}
