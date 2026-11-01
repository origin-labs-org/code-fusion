import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DEFAULT_WORKSPACE } from "./desktop-app.js";

export const E2E_HOOK_TRUST_LABELS = {
  sessionStartA: "hook-trust-session-start-a",
  sessionStartB: "hook-trust-session-start-b",
  promptSubmit: "hook-trust-prompt-submit",
} as const;

const WORKSPACE_CF_DIR = join(DEFAULT_WORKSPACE, ".cf");
const CONFIG_PATH = join(WORKSPACE_CF_DIR, "config.json");
const RECORDER_PATH = join(WORKSPACE_CF_DIR, "hook-trust-e2e-recorder.mjs");
const EVIDENCE_DIR = join(DEFAULT_WORKSPACE, ".hook-trust-e2e");
const EVIDENCE_PATH = join(EVIDENCE_DIR, "executions.jsonl");
const TRUST_STORE_PATH = join(
  dirname(DEFAULT_WORKSPACE),
  ".cf",
  "security",
  "workspace-hook-trust-v1.json",
);

export interface HookTrustExecutionRecord {
  event: string;
  label: string;
  executedAt: string;
}

export interface HookTrustStoreRecord {
  workspaceIdentity: string;
  hookDeclarationDigest: string;
  decision: string;
  eventAtGrant?: string;
}

function processHook(event: string, label: string): Record<string, unknown> {
  return {
    type: "process",
    command: process.execPath,
    args: [RECORDER_PATH, EVIDENCE_DIR, event, label],
    enabled: true,
    timeoutMs: 10000,
    statusMessage: `Workspace Hook Trust E2E — ${event} ${label}`,
  };
}

export async function installHookTrustFixture(): Promise<void> {
  await mkdir(WORKSPACE_CF_DIR, { recursive: true });
  await rm(EVIDENCE_DIR, { recursive: true, force: true });

  await writeFile(RECORDER_PATH, RECORDER_SOURCE, "utf8");
  await writeFile(
    CONFIG_PATH,
    `${JSON.stringify(
      {
        hooks: {
          enabled: true,
          timeoutMs: 10000,
          maxOutputBytes: 32768,
          events: {
            SessionStart: [
              {
                matcher: "startup",
                hooks: [
                  processHook("SessionStart", E2E_HOOK_TRUST_LABELS.sessionStartA),
                  processHook("SessionStart", E2E_HOOK_TRUST_LABELS.sessionStartB),
                ],
              },
            ],
            UserPromptSubmit: [
              {
                hooks: [processHook("UserPromptSubmit", E2E_HOOK_TRUST_LABELS.promptSubmit)],
              },
            ],
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

export async function restoreHookTrustFixture(): Promise<void> {
  await rm(CONFIG_PATH, { force: true });
  await rm(RECORDER_PATH, { force: true });
  await rm(EVIDENCE_DIR, { recursive: true, force: true });
}

export async function readHookTrustExecutions(): Promise<HookTrustExecutionRecord[]> {
  try {
    return (await readFile(EVIDENCE_PATH, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as HookTrustExecutionRecord);
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
}

export async function waitForHookTrustExecution(
  label: string,
  timeoutMsg: string,
  timeout = 30000,
): Promise<HookTrustExecutionRecord> {
  let record: HookTrustExecutionRecord | undefined;
  await browser.waitUntil(
    async () => {
      record = (await readHookTrustExecutions()).find((item) => item.label === label);
      return Boolean(record);
    },
    { timeout, timeoutMsg },
  );
  return record!;
}

export async function readHookTrustStore(): Promise<HookTrustStoreRecord[] | null> {
  let raw: string;
  try {
    raw = await readFile(TRUST_STORE_PATH, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
  const parsed = JSON.parse(raw) as { records?: HookTrustStoreRecord[] };
  return parsed.records ?? [];
}

export async function waitForHookTrustStoreRecords(
  predicate: (records: HookTrustStoreRecord[]) => boolean,
  timeoutMsg: string,
  timeout = 30000,
): Promise<HookTrustStoreRecord[]> {
  let latest: HookTrustStoreRecord[] = [];
  await browser.waitUntil(
    async () => {
      const records = await readHookTrustStore();
      if (!records) return false;
      latest = records;
      return predicate(records);
    },
    { timeout, timeoutMsg },
  );
  return latest;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT",
  );
}

const RECORDER_SOURCE = String.raw`import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const outputDirectory = process.argv[2];
const event = process.argv[3] ?? "unknown";
const label = process.argv[4] ?? "unknown";
await mkdir(outputDirectory, { recursive: true });
await appendFile(
  join(outputDirectory, "executions.jsonl"),
  JSON.stringify({ event, label, executedAt: new Date().toISOString() }) + "\n",
  "utf8",
);
`;
