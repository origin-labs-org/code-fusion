import { readFile, stat } from "node:fs/promises";
import {
  READ_IMAGE_MAX_DIMENSION,
  detectImageMediaType,
  isImageProcessorPortError,
  parseImageDataUrl,
  type ParsedImageDataUrl,
  type TraceContext,
} from "@origin-ai/cf-contracts";
import type { ToolExecutionContext } from "../types.js";
import { stripClaudeCodeHintLines } from "./bash-semantics.js";

const MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024;

export interface BashImageSource {
  artifactPath?: string;
  artifactSize?: number;
  inline: string;
}

export async function prepareBashImageOutput(
  stdout: BashImageSource,
  context: ToolExecutionContext,
): Promise<{ stdout: string } | undefined> {
  const source = stripClaudeCodeHintLines(await readBashImageSource(stdout));
  const parsed = parseImageDataUrl(source);
  if (!parsed) return undefined;
  if (!context.imageProcessorPort) return { stdout: parsed.dataUrl };

  try {
    const resized = await context.imageProcessorPort.resizeToFit(
      {
        data: parsed.data,
        maxDimension: READ_IMAGE_MAX_DIMENSION,
        mediaType: parsed.mediaType,
        trace: createToolTrace(context),
      },
      { signal: context.abortSignal },
    );
    return {
      stdout: `data:${resized.mediaType};base64,${Buffer.from(resized.data).toString("base64")}`,
    };
  } catch (error) {
    if (context.abortSignal.aborted) throw error;
    if (shouldFallbackToOriginalImage(error)) {
      const fallback = fallbackValidImageDataUrl(parsed);
      if (fallback) return fallback;
    }
    return undefined;
  }
}

async function readBashImageSource(stdout: BashImageSource): Promise<string> {
  if (!stdout.artifactPath) return stdout.inline;

  try {
    const size = stdout.artifactSize ?? (await stat(stdout.artifactPath)).size;
    if (size > MAX_IMAGE_FILE_BYTES) return stdout.inline;
    return await readFile(stdout.artifactPath, "utf8");
  } catch {
    return stdout.inline;
  }
}

function fallbackValidImageDataUrl(input: ParsedImageDataUrl): { stdout: string } | undefined {
  const detected = detectImageMediaType(input.data);
  if (!detected || detected !== input.mediaType) return undefined;
  return { stdout: input.dataUrl };
}

function shouldFallbackToOriginalImage(error: unknown): boolean {
  if (!isImageProcessorPortError(error)) return true;
  return error.code === "processing_failed";
}

function createToolTrace(context: ToolExecutionContext): TraceContext {
  return {
    traceId: context.traceId,
    spanId: context.spanId,
    parentSpanId: context.parentSpanId,
    sessionId: context.sessionId,
    turnId: context.turnId,
    attributes: {
      toolCallId: context.toolCallId,
      toolName: "Bash",
    },
  } as unknown as TraceContext;
}
