import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_SESSION_DB_PATH = "~/.cf/cli/db/db.sqlite";

async function hasDirEntry(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).length > 0;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw cause;
  }
}

function resolveMirroredSessionDbPath(path: string, home: string): string | null {
  if (path.startsWith("~/")) return join(home, path.slice(2));
  if (isAbsolute(path)) return path;
  return null;
}

function pickEnvSessionDbPath(env: NodeJS.ProcessEnv): string | undefined {
  let picked: string | undefined;
  for (const [key, value] of Object.entries(env)) {
    if ((key === "CF_SESSION_DB_PATH" || key === "CF_SESSION_DB") && value !== undefined) {
      picked = value;
    }
  }
  return picked?.trim() || undefined;
}

export interface ResolveAgentSessionDbPathOptions {
  
  env?: NodeJS.ProcessEnv;
  
  homedirPath?: string;
  
  userConfigPath?: string;
  readConfigFile?: (path: string) => Promise<string>;
}

export async function resolveAgentSessionDbPath(
  options: ResolveAgentSessionDbPathOptions = {},
): Promise<string | null> {
  const env = options.env ?? process.env;
  const home = options.homedirPath ?? homedir();
  const readConfigFile = options.readConfigFile ?? ((path) => readFile(path, "utf-8"));

  const fromEnv = pickEnvSessionDbPath(env);
  if (fromEnv) return resolveMirroredSessionDbPath(fromEnv, home);

  const userConfigPath = options.userConfigPath ?? join(home, ".cf", "cli", "config.json");
  let raw: string;
  try {
    raw = await readConfigFile(userConfigPath);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      return resolveMirroredSessionDbPath(DEFAULT_SESSION_DB_PATH, home);
    }
    throw cause;
  }
  const parsed = JSON.parse(raw) as { storage?: { sessionDbPath?: string } };
  const configured = parsed.storage?.sessionDbPath?.trim();
  if (configured) {
    const mirrored = resolveMirroredSessionDbPath(configured, home);
    if (mirrored === null) return null;
    return mirrored;
  }
  return resolveMirroredSessionDbPath(DEFAULT_SESSION_DB_PATH, home);
}

export async function hasAnyAgentSessionRow(dbPath: string): Promise<boolean> {
  try {
    await stat(dbPath);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw cause;
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 2000");
    const hasTable = db
      .prepare(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session') AS has",
      )
      .get();
    if (!hasTable?.has) return false;
    return Boolean(db.prepare("SELECT 1 FROM session LIMIT 1").get());
  } finally {
    db.close();
  }
}

export interface CreateHasExistingLocalTaskOptions {
  
  listIndexTasks: () => Promise<unknown[]>;
  
  hasAgentSessionRow: () => Promise<boolean>;
  
  resolveLegacyTaskSessionsDir: () => string;
}

export type HasExistingLocalTask = () => Promise<boolean>;

export function createHasExistingLocalTask(
  options: CreateHasExistingLocalTaskOptions,
): HasExistingLocalTask {
  return async () => {
    if ((await options.listIndexTasks()).length > 0) return true;
    if (await options.hasAgentSessionRow()) return true;
    return hasDirEntry(options.resolveLegacyTaskSessionsDir());
  };
}
