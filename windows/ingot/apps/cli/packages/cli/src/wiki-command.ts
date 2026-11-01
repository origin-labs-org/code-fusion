import { formatJson } from "@origin-ai/cf-core";
import type { Logger } from "@origin-ai/cf-contracts";
import type { GlobalOptions, RunContext } from "@origin-ai/cf-shared-types";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

interface WikiManifestPage {
  slug: string;
  title: string;
  kind: string;
  order?: number;
  sourcePaths?: string[];
}

interface WikiManifest {
  version?: number;
  language?: string;
  branch?: string;
  generatedAt?: number;
  stats?: {
    fileCount?: number;
    totalBytes?: number;
    languages?: Array<{ language: string; files: number }>;
    model?: { providerId?: string; modelId?: string; free?: boolean };
  };
  pages?: WikiManifestPage[];
}

export interface WikiCommandDependencies {
  cwd?: () => string;
  logger?: Logger;
  readTextFile?: (path: string) => Promise<string>;
}

const WIKI_COMMAND_USAGE =
  "Usage: cf wiki [list|show <slug>|path] [--lang <locale>]\n" +
  "  cf wiki            List Repo Wiki pages for the current workspace\n" +
  "  cf wiki show <slug> Print one page as Markdown\n" +
  "  cf wiki path       Print the on-disk wiki directory";

const DEFAULT_LANGUAGE = "en";

function parseLanguageFlag(args: readonly string[]): {
  language: string;
  rest: string[];
} {
  let language = process.env.CF_WIKI_LANGUAGE?.trim() || DEFAULT_LANGUAGE;
  const rest: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--lang") {
      const next = args[index + 1]?.trim();
      if (next) {
        language = next;
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("--lang=")) {
      const value = arg.slice("--lang=".length).trim();
      if (value) language = value;
      continue;
    }
    rest.push(arg);
  }
  return { language, rest };
}

function isSafeSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9\-_/]*$/.test(slug) && !slug.includes("..") && !slug.endsWith("/");
}

export const runWikiCommand = async (
  ctx: RunContext,
  options: GlobalOptions,
  deps: WikiCommandDependencies,
  args: string[],
): Promise<number> => {
  const { language, rest } = parseLanguageFlag(args);
  const subcommand = rest[0] ?? "list";
  if (subcommand === "list") {
    if (rest.length > 1) return failUsage(ctx);
    return await runWikiList(ctx, options, deps, language);
  }
  if (subcommand === "show") {
    const slug = rest[1]?.trim();
    if (rest.length !== 2 || !slug) return failUsage(ctx);
    return await runWikiShow(ctx, options, deps, language, slug);
  }
  if (subcommand === "path") {
    if (rest.length > 1) return failUsage(ctx);
    ctx.stdout.write(`${resolveWikiDir(deps, language)}\n`);
    return 0;
  }
  ctx.stderr.write(`Unknown wiki command: ${subcommand}\n${WIKI_COMMAND_USAGE}\n`);
  return 1;
};

function failUsage(ctx: RunContext): number {
  ctx.stderr.write(`${WIKI_COMMAND_USAGE}\n`);
  return 1;
}

function resolveWikiDir(deps: WikiCommandDependencies, language: string): string {
  const cwd = (deps.cwd ?? process.cwd)();
  return join(cwd, ".cf", "repowiki", language);
}

async function readManifest(
  deps: WikiCommandDependencies,
  language: string,
): Promise<WikiManifest | null> {
  const readText = deps.readTextFile ?? ((path: string) => readFile(path, "utf8"));
  try {
    const raw = await readText(join(resolveWikiDir(deps, language), "wiki.json"));
    const parsed = JSON.parse(raw) as WikiManifest;
    return Array.isArray(parsed.pages) ? parsed : null;
  } catch {
    return null;
  }
}

const runWikiList = async (
  ctx: RunContext,
  options: GlobalOptions,
  deps: WikiCommandDependencies,
  language: string,
): Promise<number> => {
  try {
    const manifest = await readManifest(deps, language);
    if (!manifest) {
      ctx.stderr.write(
        `No Repo Wiki found at ${resolveWikiDir(deps, language)}.\n` +
          "Generate one from the CodeFusion IDE (Repo Wiki → Generate) and run this command again.\n",
      );
      return 1;
    }
    if (options.json) {
      ctx.stdout.write(
        formatJson({
          directory: resolveWikiDir(deps, language),
          language,
          manifest,
        }),
      );
      return 0;
    }
    const pages = [...(manifest.pages ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const lines = [
      `Repo Wiki (${language}) — ${pages.length} pages`,
      `directory: ${resolveWikiDir(deps, language)}`,
    ];
    if (manifest.branch) lines.push(`branch: ${manifest.branch}`);
    if (manifest.stats?.fileCount) lines.push(`files indexed: ${manifest.stats.fileCount}`);
    if (manifest.stats?.model?.modelId) {
      lines.push(
        `model: ${manifest.stats.model.modelId}${manifest.stats.model.free ? " (free)" : ""}`,
      );
    }
    if (manifest.generatedAt) {
      lines.push(`generated: ${new Date(manifest.generatedAt).toISOString()}`);
    }
    lines.push("");
    for (const page of pages) {
      lines.push(`- ${page.slug}  ${page.title}${page.kind ? ` [${page.kind}]` : ""}`);
    }
    ctx.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  } catch (error) {
    return reportError(ctx, options, error);
  }
};

const runWikiShow = async (
  ctx: RunContext,
  options: GlobalOptions,
  deps: WikiCommandDependencies,
  language: string,
  slug: string,
): Promise<number> => {
  if (!isSafeSlug(slug)) {
    ctx.stderr.write(`Invalid page slug: ${slug}\n`);
    return 1;
  }
  try {
    const manifest = await readManifest(deps, language);
    if (!manifest) {
      ctx.stderr.write(`No Repo Wiki found at ${resolveWikiDir(deps, language)}.\n`);
      return 1;
    }
    const page = manifest.pages?.find((entry) => entry.slug === slug);
    if (!page) {
      ctx.stderr.write(`Unknown Repo Wiki page: ${slug}\n`);
      return 1;
    }
    const readText = deps.readTextFile ?? ((path: string) => readFile(path, "utf8"));
    const markdown = await readText(join(resolveWikiDir(deps, language), `${slug}.md`));
    if (options.json) {
      ctx.stdout.write(
        formatJson({
          slug,
          title: page.title,
          kind: page.kind,
          sourcePaths: page.sourcePaths ?? [],
          markdown,
        }),
      );
      return 0;
    }
    ctx.stdout.write(markdown.endsWith("\n") ? markdown : `${markdown}\n`);
    return 0;
  } catch (error) {
    return reportError(ctx, options, error);
  }
};

function reportError(ctx: RunContext, options: GlobalOptions, error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  ctx.stderr.write(`Error: ${message}\n`);
  if (options.verbose && error instanceof Error && error.stack) {
    ctx.stderr.write(`${error.stack}\n`);
  }
  return 1;
}
