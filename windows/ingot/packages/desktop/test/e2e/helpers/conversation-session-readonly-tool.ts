import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveE2EToolPath } from "./e2e-runtime-paths.js";

export const E2E_READONLY_TOOL_FILE_CONTENT = "E2E_READONLY_TOOL_FILE_CONTENT";
export const E2E_READONLY_TOOL_FILE_PATH = resolveE2EToolPath("shared", "readonly-tool.txt");

export async function ensureReadonlyToolFixtureFile() {
  await mkdir(dirname(E2E_READONLY_TOOL_FILE_PATH), { recursive: true });
  await writeFile(E2E_READONLY_TOOL_FILE_PATH, `${E2E_READONLY_TOOL_FILE_CONTENT}\n`, "utf-8");
}

export function buildReadonlyToolPrompt(marker: string) {
  return `${marker}: Read ${E2E_READONLY_TOOL_FILE_PATH}, then reply with exactly "upstream-e2e-ok" and no other text.`;
}
