import {
  CF_MCP_BROWSER_SCREENSHOT_CONTENT_INDICES_META_KEY,
  CF_MCP_NODE_REPL_CUA_APP_META_KEY,
} from "@origin-ai/cf-contracts/mcp";
import { isOfficialCuaImageRefText } from "@origin-ai/cf-cua/frame-contract";
import { CUA_APP_ASSOCIATIONS_META_KEY } from "@origin-ai/cf-cua/host-display-contract";
import type { NodeReplRunResult } from "@origin-ai/cf-core/repl";
import type { CallToolResult } from "@modelcontextprotocol/server";

type EmbeddedContentBlock = CallToolResult["content"][number];

interface EmbeddedMcpResult {
  content: EmbeddedContentBlock[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

function parseEmbeddedMcpResult(value: string): EmbeddedMcpResult | undefined {
  const trimmed = value.trim();
  const json = trimmed.startsWith("=>") ? trimmed.slice(2).trim() : trimmed;
  if (!json.startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const candidate = parsed as Record<string, unknown>;
    if (!Array.isArray(candidate.content)) return undefined;
    if (
      candidate.content.some(
        (block) => !block || typeof block !== "object" || typeof (block as { type?: unknown }).type !== "string",
      )
    ) {
      return undefined;
    }
    return {
      content: candidate.content as EmbeddedContentBlock[],
      ...(typeof candidate.isError === "boolean" ? { isError: candidate.isError } : {}),
      ...(candidate.structuredContent && typeof candidate.structuredContent === "object"
        ? { structuredContent: candidate.structuredContent as Record<string, unknown> }
        : {}),
      ...(candidate._meta && typeof candidate._meta === "object"
        ? { _meta: candidate._meta as Record<string, unknown> }
        : {}),
    };
  } catch {
    return undefined;
  }
}

function keepLatestCuaFrame(blocks: EmbeddedContentBlock[]): EmbeddedContentBlock[] {
  const pairStarts: number[] = [];
  blocks.forEach((block, index) => {
    if (block.type !== "image") return;
    const next = blocks[index + 1];
    if (next?.type === "text" && isOfficialCuaImageRefText(next.text)) pairStarts.push(index);
  });
  if (pairStarts.length <= 1) return blocks;
  const dropped = new Set(pairStarts.slice(0, -1).flatMap((start) => [start, start + 1]));
  return blocks.filter((_, index) => !dropped.has(index));
}

export function toMcpRunResult(run: NodeReplRunResult): CallToolResult {
  const textParts: string[] = [];
  const structuredResults = run.structuredResults ?? [];
  const embedded =
    structuredResults.length === 0 && !run.error && run.result !== undefined
      ? parseEmbeddedMcpResult(run.result)
      : undefined;
  const responseMeta = { ...run.responseMeta };
  for (const structured of structuredResults) {
    if (structured._meta) Object.assign(responseMeta, structured._meta);
  }
  if (embedded?._meta) Object.assign(responseMeta, embedded._meta);
  delete responseMeta[CF_MCP_BROWSER_SCREENSHOT_CONTENT_INDICES_META_KEY];
  delete responseMeta[CUA_APP_ASSOCIATIONS_META_KEY];
  delete responseMeta[CF_MCP_NODE_REPL_CUA_APP_META_KEY];
  if (run.cuaApp) responseMeta[CF_MCP_NODE_REPL_CUA_APP_META_KEY] = run.cuaApp;
  const browserScreenshotContentIndices = run.browserScreenshotImageIndices;
  const structuredContent = keepLatestCuaFrame(
    structuredResults.flatMap((structured) => structured.content as EmbeddedContentBlock[]),
  );
  const structuredContentResult = [...structuredResults]
    .reverse()
    .find((structured) => structured.structuredContent !== undefined);
  const structuredIsError = structuredResults.some((structured) => structured.isError === true);
  if (run.error) {
    textParts.push(run.error.message);
  } else {
    if (run.logs) textParts.push(run.logs);
    if (structuredResults.length === 0 && run.result !== undefined && !embedded) {
      textParts.push(`=> ${run.result}`);
    }
  }

  const content = [
    ...(run.error
      ? []
      : structuredResults.length > 0
        ? structuredContent
        : (run.images ?? []).map((image) => ({
            type: "image" as const,
            data: image.base64,
            mimeType: image.mimeType,
          }))),
    ...(structuredResults.length > 0
      ?
        (run.images ?? [])
          .filter(
            (image) =>
              !structuredContent.some(
                (block) =>
                  block.type === "image" &&
                  (block as { data?: string }).data === image.base64,
              ),
          )
          .map((image) => ({
            type: "image" as const,
            data: image.base64,
            mimeType: image.mimeType,
          }))
      : []),
    ...(embedded?.content ?? []),
    ...(textParts.length > 0 ? [{ type: "text" as const, text: textParts.join("\n") }] : []),
  ];

  return {
    content: content.length > 0 ? content : [{ type: "text" as const, text: "(no output)" }],
    ...(run.error || embedded?.isError || structuredIsError ? { isError: true } : {}),
    ...(structuredContentResult?.structuredContent !== undefined
      ? { structuredContent: structuredContentResult.structuredContent }
      : embedded?.structuredContent !== undefined
        ? { structuredContent: embedded.structuredContent }
        : {}),
    ...(Object.keys(responseMeta).length > 0 ||
    (run.images?.length ?? 0) > 0 ||
    structuredContent.some((block) => block.type === "image")
      ? {
          _meta: {
            ...responseMeta,
            ...((run.images?.length ?? 0) > 0 || structuredContent.some((block) => block.type === "image")
              ? { "cf/nodeReplEmittedImage": true }
              : {}),
            ...(browserScreenshotContentIndices && browserScreenshotContentIndices.length > 0
              ? {
                  [CF_MCP_BROWSER_SCREENSHOT_CONTENT_INDICES_META_KEY]:
                    browserScreenshotContentIndices,
                }
              : {}),
          },
        }
      : {}),
  };
}
