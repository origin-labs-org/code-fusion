
import type { StorageCategoryId, StorageCleanability, StorageRootId } from "@origin-ai/cf-shared";

export interface StorageCatalogContext {
  rootId: StorageRootId;
  hasCustomDataBaseDir: boolean;
}

export interface StorageClassification {
  categoryId: StorageCategoryId;
  
  entryKey: string;
}

export interface StorageCleanScope {
  prefix: string;
  recursive: boolean;
}

const CLEANABILITY: Record<StorageCategoryId, StorageCleanability> = {
  sessionStore: "none",
  subagentTranscripts: "safe",
  toolOutputs: "none",
  modelTrajectory: "safe",
  devTraces: "safe",
  logs: "safe",
  backups: "confirm",
  exports: "safe",
  runtimes: "none",
  config: "none",
  other: "none",
};

interface FileRule {
  categoryId: StorageCategoryId;
  pattern: RegExp;
  
  entryKeySegments?: number;
}

const FILE_RULES: FileRule[] = [
  {
    categoryId: "subagentTranscripts",
    pattern: /^cli\/agents\/[^/]+\/[^/]+\/transcript\.jsonl$/,
    entryKeySegments: 3,
  },
  { categoryId: "sessionStore", pattern: /^v2\/[^/]+\.sqlite(?:-wal|-shm)?$/ },
  { categoryId: "sessionStore", pattern: /^cli\/db\/db\.sqlite(?:-wal|-shm)?$/ },
  { categoryId: "toolOutputs", pattern: /^v2\/checkpoints\/(?:.+\/)?(?:pending|tmp)\// },
  { categoryId: "backups", pattern: /^cli\/db\/db\.sqlite\.[^/]+$/ },
  { categoryId: "backups", pattern: /^cli\/config\.json\.bak[^/]*$/ },
  { categoryId: "backups", pattern: /^v2\/[^/]+\.bak$/ },
  { categoryId: "backups", pattern: /^v2\/[^/]+\.backup\.json$/ },
  { categoryId: "backups", pattern: /^v2\/setting\.json\.(?:corrupt-|[^/]*backup)[^/]*$/ },
  { categoryId: "backups", pattern: /^v2\/config\.json\.pre-[^/]+$/ },
  { categoryId: "toolOutputs", pattern: /^v2\/coding-plan-cache\.json$/ },
  { categoryId: "toolOutputs", pattern: /^v2\/bots-model-cache[^/]*\.json$/ },
  { categoryId: "logs", pattern: /^computer-use\/run\/[^/]+\.log$/ },
  { categoryId: "config", pattern: /^v2\/[^/]+\.json$/ },
  { categoryId: "config", pattern: /^cli\/config\.json$/ },
  { categoryId: "config", pattern: /^agents\/[^/]+\.md$/ },
  { categoryId: "config", pattern: /^AGENTS\.md$/ },
];

const PREFIX_RULES: Record<Exclude<StorageCategoryId, "other">, string[]> = {
  sessionStore: ["v2/sessions", "v2/session-bindings", "v2/checkpoints"],
  subagentTranscripts: [],
  toolOutputs: [
    "cli/artifacts",
    "cli/agents",
    "cli/sessions",
    "cli/exec",
    "cli/image-cache",
    "cli/pdf-cache",
    "clipboard",
    "git-checkpoint-index",
    "editor-icon",
    "tmp",
    "cache",
  ],
  modelTrajectory: ["cli/debug", "cli/rollout"],
  devTraces: ["v2/dev", "v2/acp-traffic-proxy", "v2/acp-stream-diagnostics"],
  logs: ["v2/logs", "cli/log", "logs", "v2/crash", "v2/perf", "feedback/logs"],
  backups: ["backup", "v2/backup", "v2/migrations", "cli/db/backup", "cli/db/backups"],
  exports: ["export-log", "export-log-stage", "feedback"],
  runtimes: ["agents", "bundled-agents", "lite", "computer-use", "cli/plugins"],
  config: [
    "v2/agent-config",
    "v2/bots-runtime-locks",
    "v2/bot-attachments",
    "v2/certs",
    "v2/acp-auth",
    "v2/acp-config",
    "v2/provider",
    "cli/models",
    "cli/memories",
    "cli/workflows",
    "security",
    "commands",
    "skills",
    "workflows",
    "workspace",
    "mailbox",
    "server",
    "controller",
    "launcher",
    "dev-signing",
    "cua-helper-dev-identity",
    "perf-task-manifests",
    "plugin-workspace",
    "projects",
  ],
};

const PREFIX_INDEX: Array<{ prefix: string; categoryId: StorageCategoryId }> = Object.entries(
  PREFIX_RULES,
)
  .flatMap(([categoryId, prefixes]) =>
    prefixes.map((prefix) => ({ prefix, categoryId: categoryId as StorageCategoryId })),
  )
  .sort((a, b) => b.prefix.length - a.prefix.length);

const PROTECTED_BASENAMES = new Set([
  "setting.json",
  "setting.json.lock",
  "credentials.json",
  ".credentials.json",
  ".tokens",
  "cf-stdio-tap.json",
]);
const PROTECTED_PREFIXES = ["v2/crash/live"];

export function normalizeStorageRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function isUnderPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function entryKeyBelow(path: string, prefix: string): string {
  const rest = path.slice(prefix.length + 1);
  const next = rest.split("/")[0];
  return next ? `${prefix}/${next}` : prefix;
}

export function classifyStoragePath(
  rawPath: string,
  context: StorageCatalogContext,
): StorageClassification {
  const path = normalizeStorageRelativePath(rawPath);
  if (context.rootId === "home" && context.hasCustomDataBaseDir && isUnderPrefix(path, "v2")) {
    return { categoryId: "other", entryKey: "v2" };
  }
  if (isUnderPrefix(path, "agent")) {
    return { categoryId: "other", entryKey: "agent" };
  }
  for (const rule of FILE_RULES) {
    if (rule.pattern.test(path)) {
      const entryKey = rule.entryKeySegments
        ? path.split("/").slice(0, rule.entryKeySegments).join("/")
        : path;
      return { categoryId: rule.categoryId, entryKey };
    }
  }
  for (const { prefix, categoryId } of PREFIX_INDEX) {
    if (isUnderPrefix(path, prefix)) {
      return { categoryId, entryKey: entryKeyBelow(path, prefix) };
    }
  }
  return { categoryId: "other", entryKey: path.split("/")[0] ?? path };
}

export function getStorageCategoryCleanability(categoryId: StorageCategoryId): StorageCleanability {
  return CLEANABILITY[categoryId];
}

export function isProtectedStoragePath(rawPath: string): boolean {
  const path = normalizeStorageRelativePath(rawPath);
  const basename = path.split("/").at(-1) ?? path;
  if (PROTECTED_BASENAMES.has(basename)) return true;
  return PROTECTED_PREFIXES.some((prefix) => isUnderPrefix(path, prefix));
}

const FILE_RULE_SCOPES: Partial<Record<StorageCategoryId, string[]>> = {
  backups: ["cli/db", "cli", "v2"],
  logs: ["computer-use/run"],
};

const RECURSIVE_FILE_RULE_SCOPES: Partial<Record<StorageCategoryId, string[]>> = {
  subagentTranscripts: ["cli/agents"],
};

export function getStorageCleanScopes(categoryId: StorageCategoryId): StorageCleanScope[] {
  if (categoryId === "other" || CLEANABILITY[categoryId] === "none") return [];
  const recursive = [
    ...PREFIX_RULES[categoryId],
    ...(RECURSIVE_FILE_RULE_SCOPES[categoryId] ?? []),
  ].map((prefix) => ({ prefix, recursive: true }));
  const shallow = (FILE_RULE_SCOPES[categoryId] ?? []).map((prefix) => ({
    prefix,
    recursive: false,
  }));
  return [...recursive, ...shallow];
}
