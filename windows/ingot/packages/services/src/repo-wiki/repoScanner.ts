import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".cf",
  ".qoder",
  ".claude",
  ".venv",
  "venv",
  "__pycache__",
  "node_modules",
  "bower_components",
  "vendor",
  "third-party",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".parcel-cache",
  "target",
  ".gradle",
  ".idea",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".terraform",
  "Pods",
  "DerivedData",
]);

const SKIPPED_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "icns",
  "pdf",
  "zip",
  "tar",
  "gz",
  "tgz",
  "bz2",
  "xz",
  "7z",
  "rar",
  "exe",
  "dll",
  "so",
  "dylib",
  "bin",
  "o",
  "a",
  "obj",
  "class",
  "jar",
  "wasm",
  "mp3",
  "mp4",
  "mov",
  "avi",
  "wav",
  "flac",
  "ogg",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "psd",
  "ai",
  "sketch",
  "db",
  "sqlite",
  "sqlite3",
  "lockb",
]);

const SKIPPED_FILE_NAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "Cargo.lock",
  "poetry.lock",
  "uv.lock",
  "composer.lock",
  "Gemfile.lock",
]);

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  mts: "TypeScript",
  cts: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  rs: "Rust",
  go: "Go",
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin",
  swift: "Swift",
  c: "C",
  h: "C",
  cc: "C++",
  cpp: "C++",
  cxx: "C++",
  hpp: "C++",
  hh: "C++",
  cs: "C#",
  rb: "Ruby",
  php: "PHP",
  scala: "Scala",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  ps1: "PowerShell",
  sql: "SQL",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  sass: "SCSS",
  less: "Less",
  md: "Markdown",
  mdx: "Markdown",
  json: "JSON",
  jsonc: "JSON",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  xml: "XML",
  gradle: "Gradle",
  cmake: "CMake",
  proto: "Protobuf",
  graphql: "GraphQL",
  gql: "GraphQL",
  vue: "Vue",
  svelte: "Svelte",
  dart: "Dart",
  lua: "Lua",
  r: "R",
  jl: "Julia",
  ex: "Elixir",
  exs: "Elixir",
  erl: "Erlang",
  hs: "Haskell",
  ml: "OCaml",
  zig: "Zig",
  nim: "Nim",
  sol: "Solidity",
  tf: "Terraform",
  dockerfile: "Docker",
};

const MANIFEST_FILE_NAMES = [
  "package.json",
  "pyproject.toml",
  "setup.py",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle.kts",
  "build.gradle",
  "CMakeLists.txt",
  "Makefile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "Dockerfile",
  "tsconfig.json",
  "vitest.config.ts",
  "vite.config.ts",
  "next.config.mjs",
  "pnpm-workspace.yaml",
  "mise.toml",
  ".env.example",
];

const DOC_FILE_NAMES = [
  "README.md",
  "README",
  "ARCHITECTURE.md",
  "CONTRIBUTING.md",
  "AGENTS.md",
  "CLAUDE.md",
  "DESIGN.md",
  "BRAND_GUIDELINES.md",
  "docs/README.md",
];

export interface RepoScanFile {
  relativePath: string;
  size: number;
  language: string;
}

export interface RepoScanModule {
  path: string;
  name: string;
  fileCount: number;
  samplePaths: string[];
}

export interface RepoScanLanguage {
  language: string;
  files: number;
}

export interface RepoScanExcerpt {
  relativePath: string;
  content: string;
  truncated: boolean;
}

export interface RepoScanResult {
  projectName: string;
  files: RepoScanFile[];
  modules: RepoScanModule[];
  languages: RepoScanLanguage[];
  totalBytes: number;
  fingerprint: string;
  excerpts: RepoScanExcerpt[];
  rootEntries: string[];
}

export interface ScanRepoOptions {
  maxFiles?: number;
  /** Hard ceiling on entries visited, before language filtering. */
  maxEnumeratedFiles?: number;
  maxDepth?: number;
  /** Ceiling on entries in one directory (files + subdirectories). */
  maxDirFiles?: number;
  maxExcerpts?: number;
  maxExcerptChars?: number;
  maxTotalExcerptChars?: number;
}

// Caps mirror Qoder's shipped mtree defaults (maxFileNum 250000, maxIndexingFileNum
// 100000, maxDepth 100, maxDirFileNum 10000) so a generation run behaves the same on
// the same repository. Excerpt budgets stay local to the prompt, not the scan.
const DEFAULT_MAX_FILES = 100_000;
const DEFAULT_MAX_ENUMERATED_FILES = 250_000;
const DEFAULT_MAX_DEPTH = 100;
const DEFAULT_MAX_DIR_FILES = 10_000;
const DEFAULT_MAX_EXCERPTS = 60;
const DEFAULT_MAX_EXCERPT_CHARS = 6_000;
const DEFAULT_MAX_TOTAL_EXCERPT_CHARS = 90_000;

/** Qoder's ignore file name, observed in featureFlags.json (`codebaseIgnoreFileName`). */
export const REPO_WIKI_IGNORE_FILE = ".qoderignore";

function globToIgnoreMatcher(glob: string): (relativePath: string, isDir: boolean) => boolean {
  const directoryOnly = glob.endsWith("/");
  const body = directoryOnly ? glob.slice(0, -1) : glob;
  const escaped = body.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped.replace(/\*/g, "[^/]*")}(?:/.*)?$`);
  return (relativePath, isDir) => {
    if (directoryOnly && !isDir) return false;
    if (pattern.test(relativePath)) return true;
    const name = relativePath.split("/").pop() ?? relativePath;
    return !body.includes("/") && !directoryOnly && pattern.test(name);
  };
}

/** Read `.qoderignore` (gitignore-style subset: comments, dir rules, `*` globs). */
async function loadIgnoreMatcher(
  workspacePath: string,
): Promise<(relativePath: string, isDir: boolean) => boolean> {
  let raw = "";
  try {
    raw = await readFile(join(workspacePath, REPO_WIKI_IGNORE_FILE), "utf8");
  } catch {
    return () => false;
  }
  const matchers = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("!"))
    .map(globToIgnoreMatcher);
  if (matchers.length === 0) return () => false;
  return (relativePath, isDir) => matchers.some((matches) => matches(relativePath, isDir));
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return "";
  return fileName.slice(dot + 1).toLowerCase();
}

function languageOf(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return "Docker";
  if (lower === "makefile" || lower.endsWith(".mk")) return "Makefile";
  return LANGUAGE_BY_EXTENSION[extensionOf(fileName)] ?? "Other";
}

function fileNameMatches(candidate: string, wanted: string): boolean {
  return candidate.toLowerCase() === wanted.toLowerCase();
}

function moduleKeyOf(relativePath: string): string {
  const segments = relativePath.split("/");
  if (segments.length === 1) return "(root)";
  return segments[0] ?? "(root)";
}

function isKeyDocument(relativePath: string): boolean {
  const name = basename(relativePath);
  if (DOC_FILE_NAMES.some((doc) => fileNameMatches(relativePath, doc) || fileNameMatches(name, doc))) {
    return true;
  }
  return MANIFEST_FILE_NAMES.some((manifest) => fileNameMatches(name, manifest));
}

function pickExcerptCandidates(
  files: readonly RepoScanFile[],
  maxExcerpts: number,
): RepoScanFile[] {
  const picked: RepoScanFile[] = [];
  const seen = new Set<string>();

  const push = (file: RepoScanFile) => {
    if (seen.has(file.relativePath)) return;
    seen.add(file.relativePath);
    picked.push(file);
  };

  for (const file of files) {
    if (isKeyDocument(file.relativePath)) push(file);
  }

  const byModule = new Map<string, RepoScanFile[]>();
  for (const file of files) {
    if (file.language === "Markdown" || file.language === "JSON") continue;
    if (file.size < 200 || file.size > 60_000) continue;
    const key = moduleKeyOf(file.relativePath);
    const bucket = byModule.get(key) ?? [];
    bucket.push(file);
    byModule.set(key, bucket);
  }

  // Prefer shallow, mid-sized files: they carry the most structure per byte.
  const ranked = [...byModule.values()].flatMap((bucket) =>
    bucket
      .sort(
        (a, b) =>
          a.relativePath.split("/").length - b.relativePath.split("/").length ||
          a.relativePath.localeCompare(b.relativePath),
      )
      .slice(0, 3),
  );

  for (const file of ranked) {
    if (picked.length >= maxExcerpts) break;
    push(file);
  }

  return picked.slice(0, maxExcerpts);
}

async function readExcerpt(
  workspacePath: string,
  file: RepoScanFile,
  maxChars: number,
): Promise<RepoScanExcerpt | null> {
  try {
    const raw = await readFile(join(workspacePath, ...file.relativePath.split("/")), "utf8");
    const normalized = raw.replace(/\r\n/g, "\n");
    const truncated = normalized.length > maxChars;
    return {
      relativePath: file.relativePath,
      content: truncated ? normalized.slice(0, maxChars) : normalized,
      truncated,
    };
  } catch {
    return null;
  }
}

/**
 * Scan a workspace into a compact, deterministic repository digest. The scan is bounded so
 * a generation run never walks vendored dependency trees or binary payloads.
 */
export async function scanRepo(
  workspacePath: string,
  options: ScanRepoOptions = {},
): Promise<RepoScanResult> {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxEnumeratedFiles = options.maxEnumeratedFiles ?? DEFAULT_MAX_ENUMERATED_FILES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxDirFiles = options.maxDirFiles ?? DEFAULT_MAX_DIR_FILES;
  const maxExcerpts = options.maxExcerpts ?? DEFAULT_MAX_EXCERPTS;
  const maxExcerptChars = options.maxExcerptChars ?? DEFAULT_MAX_EXCERPT_CHARS;
  const maxTotalExcerptChars =
    options.maxTotalExcerptChars ?? DEFAULT_MAX_TOTAL_EXCERPT_CHARS;

  const files: RepoScanFile[] = [];
  const rootEntries: string[] = [];
  const ignored = await loadIgnoreMatcher(workspacePath);
  let enumerated = 0;
  let truncated = false;

  const walk = async (relativeDirectory: string, depth: number): Promise<void> => {
    if (truncated || depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(
        relativeDirectory ? join(workspacePath, ...relativeDirectory.split("/")) : workspacePath,
        { withFileTypes: true },
      );
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const boundedEntries = entries.slice(0, maxDirFiles);
    if (boundedEntries.length < entries.length) truncated = true;
    for (const entry of boundedEntries) {
      if (truncated) return;
      if (entry.name.startsWith(".") && entry.name !== ".env.example") {
        if (entry.isDirectory()) continue;
      }
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        const child = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
        if (ignored(child, true)) continue;
        if (!relativeDirectory) rootEntries.push(`${entry.name}/`);
        await walk(child, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (SKIPPED_FILE_NAMES.has(entry.name)) continue;
      if (SKIPPED_EXTENSIONS.has(extensionOf(entry.name))) continue;
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      if (ignored(relativePath, false)) continue;
      enumerated += 1;
      if (enumerated > maxEnumeratedFiles) {
        truncated = true;
        return;
      }
      if (!relativeDirectory) rootEntries.push(entry.name);
      let size = 0;
      try {
        size = (await stat(join(workspacePath, ...relativePath.split("/")))).size;
      } catch {
        continue;
      }
      files.push({ relativePath, size, language: languageOf(entry.name) });
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
    }
  };

  await walk("", 0);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const languageCounts = new Map<string, number>();
  let totalBytes = 0;
  for (const file of files) {
    totalBytes += file.size;
    languageCounts.set(file.language, (languageCounts.get(file.language) ?? 0) + 1);
  }
  const languages = [...languageCounts.entries()]
    .map(([language, count]) => ({ language, files: count }))
    .sort((a, b) => b.files - a.files);

  const moduleMap = new Map<string, RepoScanFile[]>();
  for (const file of files) {
    const key = moduleKeyOf(file.relativePath);
    const bucket = moduleMap.get(key) ?? [];
    bucket.push(file);
    moduleMap.set(key, bucket);
  }
  const modules: RepoScanModule[] = [...moduleMap.entries()]
    .map(([path, bucket]) => ({
      path,
      name: path === "(root)" ? basename(workspacePath) : path,
      fileCount: bucket.length,
      samplePaths: bucket.slice(0, 6).map((file) => file.relativePath),
    }))
    .sort((a, b) => b.fileCount - a.fileCount);

  const hash = createHash("sha256");
  hash.update(
    files.map((file) => `${file.relativePath}\u0000${file.size}`).join("\n"),
  );

  const excerptCandidates = pickExcerptCandidates(files, maxExcerpts);
  const excerpts: RepoScanExcerpt[] = [];
  let excerptBudget = maxTotalExcerptChars;
  for (const candidate of excerptCandidates) {
    if (excerptBudget <= 0) break;
    const excerpt = await readExcerpt(
      workspacePath,
      candidate,
      Math.min(maxExcerptChars, excerptBudget),
    );
    if (!excerpt) continue;
    excerptBudget -= excerpt.content.length;
    excerpts.push(excerpt);
  }

  return {
    projectName: basename(workspacePath) || "workspace",
    files,
    modules,
    languages,
    totalBytes,
    fingerprint: hash.digest("hex"),
    excerpts,
    rootEntries: rootEntries.sort(),
  };
}
