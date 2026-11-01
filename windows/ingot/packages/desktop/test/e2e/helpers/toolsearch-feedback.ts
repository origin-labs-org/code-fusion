import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { createToolSearchCliFixture } from "./toolsearch-cli-process.js";
import { toolSearchBlocks, type ToolSearchRequest } from "./toolsearch-provider.js";

export type SearchFixture = Awaited<ReturnType<typeof createToolSearchCliFixture>>;
export type SearchMode = "native" | "local";
export const feedbackCase = "conversation-session-toolsearch-feedback";
export const recordingCase = "conversation-session-toolsearch-recording";

export function resultFor(body: ToolSearchRequest, id: string) {
  const result = toolSearchBlocks(body).find(
    (block) => block.type === "tool_result" && block.tool_use_id === id,
  );
  expect(result).toBeDefined();
  return result!;
}

export function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(contentText).join("\n");
  if (content && typeof content === "object" && "text" in content) return String(content.text);
  return "";
}

export function loadedCount(body: ToolSearchRequest): number {
  return body.messages.reduce(
    (total, message) => total + (contentText(message.content).match(/Tool loaded\./g)?.length ?? 0),
    0,
  );
}

export function definitionsFor(body: ToolSearchRequest, id: string): string[] {
  const result = resultFor(body, id);
  if (
    Array.isArray(result.content) &&
    result.content.some((block) => block.type === "tool_reference")
  )
    return result.content
      .filter((block) => block.type === "tool_reference")
      .map((block) => block.tool_name!);
  return [...contentText(result.content).matchAll(/<function>(.*?)<\/function>/g)].map(
    (match) => (JSON.parse(match[1]!) as { name: string }).name,
  );
}

export function replyStage(
  fixture: SearchFixture,
  body: ToolSearchRequest,
  response: Parameters<SearchFixture["reply"]>[1],
  stage: string,
) {
  fixture.reply(body, response, `${stage}-${body.stream ? "stream" : "json"}`);
}

export async function runFeedback(
  fixture: SearchFixture,
  mode: SearchMode,
  marker: string,
  extra: string[] = [],
) {
  const run = await fixture.start(["--toolsearch-mode", mode, ...extra, "-p", marker]).done;
  expect({ code: run.code, stderr: run.code === 0 ? "" : run.stderr }).toEqual({
    code: 0,
    stderr: "",
  });
  return (JSON.parse(run.stdout) as { sessionId: string }).sessionId;
}

export async function saveSearchEvidence(
  label: string,
  fixture: SearchFixture,
  extra: Record<string, unknown> = {},
) {
  const root = process.env.CF_E2E_ARTIFACT_DIR;
  if (!root) throw new Error("Missing E2E artifact directory");
  const directory = join(root, "toolsearch-wire");
  await mkdir(directory, { recursive: true });
  const modelIoDirectory = join(directory, label, "model-io");
  await mkdir(modelIoDirectory, { recursive: true });
  const debugDirectory = join(fixture.root, "storage", "cli", "debug");
  const logs = (await readdir(debugDirectory)).filter(
    (name) => name.startsWith("model-io-") && name.endsWith(".jsonl"),
  );
  expect(logs.length).toBeGreaterThan(0);
  await Promise.all(
    logs.map((name) => copyFile(join(debugDirectory, name), join(modelIoDirectory, name))),
  );
  await writeFile(
    join(directory, `${label}.json`),
    JSON.stringify(
      {
        kind: "controlled-provider-http",
        requests: fixture.requests.map(({ body, fixtureId }) => ({ body, fixtureId })),
        ...extra,
      },
      null,
      2,
    ),
  );
}
