import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DEFAULT_WORKSPACE } from "./desktop-app.js";

export const PERMISSION_HOOK_RACE_MARKER = "E2E_PERMISSION_HOOK_RACE";
export const PERMISSION_HOOK_RACE_FINAL_MARKER =
  "E2E_PERMISSION_HOOK_RACE_DONE";
export const PERMISSION_HOOK_RACE_RESULT_CONTENT =
  "E2E_PERMISSION_HOOK_RACE_RESULT\n";

const BLOCKING_HOOK_SLEEP_MS = 120000;
const BLOCKING_HOOK_TIMEOUT_MS = 130000;

const WORKSPACE_CF_DIR = join(DEFAULT_WORKSPACE, ".cf");
const USER_CONFIG_DIR = join(dirname(DEFAULT_WORKSPACE), ".cf", "cli");
const CONFIG_PATH = join(USER_CONFIG_DIR, "config.json");
const BLOCKER_PATH = join(
  WORKSPACE_CF_DIR,
  "permission-hook-race-blocker.mjs",
);
const TRACE_PATH = join(WORKSPACE_CF_DIR, "permission-hook-race-trace.jsonl");

let originalConfig: string | null = null;

export interface PermissionHookRaceTraceRecord
  extends Record<string, unknown> {
  phase?: string;
  hook_event_name?: string;
  tool_name?: string;
}

export async function installPermissionHookRaceFixture(): Promise<void> {
  await mkdir(WORKSPACE_CF_DIR, { recursive: true });
  await mkdir(USER_CONFIG_DIR, { recursive: true });
  await rm(TRACE_PATH, { force: true });
  originalConfig = await readFile(CONFIG_PATH, "utf8").catch(
    (error: unknown) => {
      if (isMissingFileError(error)) return null;
      throw error;
    },
  );
  const existing = originalConfig
    ? (JSON.parse(originalConfig) as Record<string, unknown>)
    : {};
  await writeFile(BLOCKER_PATH, BLOCKER_SOURCE, "utf8");

  await writeFile(
    CONFIG_PATH,
    `${JSON.stringify(
      {
        ...existing,
        hooks: {
          enabled: true,
          timeoutMs: BLOCKING_HOOK_TIMEOUT_MS,
          maxOutputBytes: 32768,
          events: {
            PermissionRequest: [
              {
                matcher: "Write",
                hooks: [
                  {
                    type: "command",
                    command: `"${process.execPath}" "${BLOCKER_PATH}" "${TRACE_PATH}"`,
                    timeoutMs: BLOCKING_HOOK_TIMEOUT_MS,
                  },
                ],
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

export async function restorePermissionHookRaceFixture(): Promise<void> {
  if (originalConfig === null) {
    await rm(CONFIG_PATH, { force: true });
  } else {
    await writeFile(CONFIG_PATH, originalConfig, "utf8");
  }
  await rm(BLOCKER_PATH, { force: true });
  await rm(TRACE_PATH, { force: true });
}

export async function readPermissionHookRaceTrace(): Promise<
  PermissionHookRaceTraceRecord[]
> {
  try {
    return (await readFile(TRACE_PATH, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as PermissionHookRaceTraceRecord);
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
}

export async function waitForBlockingHookStarted(
  timeout = 30000,
): Promise<void> {
  await browser.waitUntil(
    async () => {
      const records = await readPermissionHookRaceTrace();
      return records.some(
        (record) =>
          record.phase === "started" &&
          record.hook_event_name === "PermissionRequest" &&
          record.tool_name === "Write",
      );
    },
    {
      timeout,
      timeoutMsg:
        "阻塞的 PermissionRequest hook 没有启动（竞速场景未成立，检查 hooks 配置是否生效）",
    },
  );
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT",
  );
}

const BLOCKER_SOURCE = String.raw`import { appendFileSync } from "node:fs";

const tracePath = process.argv[2];
const record = (phase, extra = {}) => {
  appendFileSync(
    tracePath,
    JSON.stringify({ phase, at: new Date().toISOString(), ...extra }) + "\n",
  );
};

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw);
record("started", {
  hook_event_name: input.hook_event_name,
  tool_name: input.tool_name,
});

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => {
    record("aborted", { signal });
    process.exit(143);
  });
}

await new Promise((resolveSleep) => setTimeout(resolveSleep, ${BLOCKING_HOOK_SLEEP_MS}));
record("settled-without-decision");
`;
