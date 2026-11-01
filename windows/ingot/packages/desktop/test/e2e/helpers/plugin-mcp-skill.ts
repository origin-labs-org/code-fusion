import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const FIXTURES_ROOT = resolve(
  dirname(new URL(import.meta.url).pathname),
  "..",
  "fixtures",
  "plugin-mcp-skill",
);
const PLUGIN_ROOT = join(FIXTURES_ROOT, "e2e-plugin-mcp-ping");

export const PLUGIN_MCP_FIXTURE_DIR = FIXTURES_ROOT;
export const PLUGIN_MCP_PLUGIN_ROOT = PLUGIN_ROOT;
export const PLUGIN_MCP_PLUGIN_ID = "e2e-plugin-mcp-ping@e2e-fixture";
// `apps/cli/packages/adapters/src/mcp/index.ts:normalizeMcpToolDescriptor`。
export const PLUGIN_MCP_TOOL_NAME = "mcp__plugin_e2e-plugin-mcp-ping_ping__ping";
export const PLUGIN_MCP_MARKER_PREFIX = "E2E_PLUGIN_MCP_PING";

export function captureArtifactAdvertisesToolName(requestJson: unknown, toolName: string): boolean {
  if (!requestJson || typeof requestJson !== "object") return false;
  const tools = (requestJson as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return false;
  return tools.some(
    (tool) =>
      tool !== null && typeof tool === "object" && (tool as { name?: unknown }).name === toolName,
  );
}

export async function findUpstreamRequestContaining(
  marker: string,
  timeoutMs = 30000,
  options?: { advertisedToolName?: string },
): Promise<{ method: string; path: string; requestJson: unknown } | null> {
  const capturePath = process.env.E2E_PROVIDER_CAPTURE_PATH?.trim();
  if (!capturePath) return null;
  const deadline = Date.now() + timeoutMs;
  let latest: { method: string; path: string; requestJson: unknown } | null = null;
  while (Date.now() < deadline) {
    const artifact = await readCaptureArtifact(capturePath);
    if (artifact) {
      for (const record of artifact.records) {
        if (
          containsText(record.requestJson, marker) &&
          (!options?.advertisedToolName ||
            captureArtifactAdvertisesToolName(record.requestJson, options.advertisedToolName))
        ) {
          latest = {
            method: record.method,
            path: record.path,
            requestJson: record.requestJson,
          };
        }
      }
    }
    if (latest) return latest;
    await sleep(250);
  }
  return latest;
}

async function readCaptureArtifact(capturePath: string): Promise<{
  records: Array<{ method: string; path: string; requestJson: unknown }>;
} | null> {
  try {
    const raw = await readFile(capturePath, "utf-8");
    const parsed = JSON.parse(raw) as {
      records?: Array<{ method: string; path: string; requestJson?: unknown }>;
    };
    if (!parsed || !Array.isArray(parsed.records)) return null;
    return {
      records: parsed.records.map((record) => ({
        method: record.method,
        path: record.path,
        requestJson: record.requestJson ?? null,
      })),
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

function containsText(value: unknown, expected: string): boolean {
  if (typeof value === "string") return value.includes(expected);
  if (Array.isArray(value)) return value.some((item) => containsText(item, expected));
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some((child) => containsText(child, expected));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
