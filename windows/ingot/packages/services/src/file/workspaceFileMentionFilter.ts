import { extname } from "node:path";

const SKIPPED_DIRECTORY_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "bower_components",
  "jspm_packages",
  "__pycache__",
  "site-packages",
  "venv",
  "coverage",
  "htmlcov",
  "lcov-report",
  "cmakefiles",
  "pods",
  "deriveddata",
  "storybook-static",
  "playwright-report",
  "test-results",
  "allure-results",
  "allure-report",
  "cdk.out",
  "eggs",
  "pip-wheel-metadata",
  "wheels",
]);
const SKIPPED_DIRECTORY_PREFIXES = ["cmake-build-", "bazel-"];
const SKIPPED_DIRECTORY_SUFFIXES = [".egg-info", ".dist-info"];
const SKIPPED_FILE_NAMES = new Set(["coverage.out", "lcov.info"]);
const SKIPPED_FILE_EXTENSIONS = new Set([
  ".a",
  ".aar",
  ".beam",
  ".class",
  ".dll",
  ".dylib",
  ".ear",
  ".exe",
  ".gcda",
  ".gcno",
  ".gem",
  ".hi",
  ".idb",
  ".ilk",
  ".jar",
  ".lib",
  ".node",
  ".nupkg",
  ".o",
  ".obj",
  ".pdb",
  ".profdata",
  ".profraw",
  ".pyc",
  ".pyo",
  ".rlib",
  ".so",
  ".tsbuildinfo",
  ".war",
]);

export interface WorkspaceFileSearchEntry {
  name: string;
  path: string;
  relativePath: string;
  type: "file" | "directory";
}

export interface WorkspaceFileSearchDecision {
  include: boolean;
  traverse: boolean;
}

export interface WorkspaceFileSearchFilterContext {
  
  ignoreRulesActive: boolean;
}

export interface WorkspaceFileSearchFilter {
  evaluate(
    entry: WorkspaceFileSearchEntry,
    context?: WorkspaceFileSearchFilterContext,
  ): WorkspaceFileSearchDecision;
}

function shouldSkipDirectory(name: string): boolean {
  const normalizedName = name.toLowerCase();
  return (
    SKIPPED_DIRECTORY_NAMES.has(normalizedName) ||
    SKIPPED_DIRECTORY_PREFIXES.some((prefix) => normalizedName.startsWith(prefix)) ||
    SKIPPED_DIRECTORY_SUFFIXES.some((suffix) => normalizedName.endsWith(suffix))
  );
}

function shouldSkipFile(name: string): boolean {
  const normalizedName = name.toLowerCase();
  return (
    normalizedName === ".env" ||
    normalizedName.startsWith(".env.") ||
    SKIPPED_FILE_NAMES.has(normalizedName) ||
    SKIPPED_FILE_EXTENSIONS.has(extname(normalizedName))
  );
}

function isInsideHiddenDirectory(relativePath: string): boolean {
  const segments = relativePath.split("/");
  const directorySegments = segments.slice(0, -1);
  return directorySegments.some((segment) => segment.startsWith("."));
}

export const defaultWorkspaceFileSearchFilter: WorkspaceFileSearchFilter = {
  evaluate(entry, context) {
    if (entry.type === "directory") {
      if (!context?.ignoreRulesActive && shouldSkipDirectory(entry.name)) {
        return { include: false, traverse: false };
      }
      const hiddenDirectory =
        entry.name.startsWith(".") || isInsideHiddenDirectory(entry.relativePath);
      return { include: !hiddenDirectory, traverse: true };
    }

    return { include: !shouldSkipFile(entry.name), traverse: false };
  },
};
