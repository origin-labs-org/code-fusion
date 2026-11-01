import type { ModelMessage as AiSdkModelMessage } from "ai";
import {
  getUnsupportedModelInputMediaKind,
  modelMessageContentToText,
  type ModelInputFormat,
  type ModelMessageContent,
  type ModelMessageContentBlock,
} from "@origin-ai/cf-contracts";
import { containsOfficialCuaImageRefCredentialText } from "@origin-ai/cf-cua/frame-contract";
import { dataUrlToDataContent, unsupportedInputMediaText } from "./media-transform-policy.js";

type AiSdkUserContent = Extract<AiSdkModelMessage, { role: "user" }>["content"];
type AiSdkUserContentParts = Extract<AiSdkUserContent, unknown[]>;

interface ToolResultMediaProjectionOptions {
  apiFormat?: string;
  providerKind?: "openai" | "anthropic" | "openai-compatible" | "gateway" | "custom";
  stripMedia?: boolean;
  inputFormat?: ModelInputFormat;
  toolName: string;
}

const CHAT_STYLE_TOOL_RESULT_PROVIDER_KINDS = new Set(["openai-compatible", "gateway"]);
const TOOL_RESULT_MEDIA_INTRO_PREFIX = "Tool result media from";

export function shouldTextifyStructuredToolResults(
  options: Pick<ToolResultMediaProjectionOptions, "apiFormat" | "providerKind">,
): boolean {
  if (options.apiFormat !== undefined) {
    return options.apiFormat === "openai-chat-completions";
  }
  return (
    options.providerKind !== undefined &&
    CHAT_STYLE_TOOL_RESULT_PROVIDER_KINDS.has(options.providerKind)
  );
}

export function toolResultHasVideoMedia(content: ModelMessageContent): boolean {
  if (typeof content === "string") return false;
  return content.some((block) => block.type === "video");
}

type PairedTextOptions = Pick<ToolResultMediaProjectionOptions, "stripMedia" | "inputFormat">;

function isPairedTextBlock(
  content: ModelMessageContentBlock[],
  index: number,
  options: PairedTextOptions,
): boolean {
  const block = content[index];
  if (block?.type !== "text" || block.text.trim().length === 0) return false;
  if (!containsOfficialCuaImageRefCredentialText(block.text)) return false;
  const candidate = content[index - 1];
  return (
    candidate !== undefined &&
    contentBlockToUserMediaParts(candidate, {
      ...options,
      toolName: "",
    }).length > 0
  );
}

function pairedTextIndexes(
  content: ModelMessageContentBlock[],
  options: PairedTextOptions,
): Set<number> {
  if (options.stripMedia === true) return new Set();
  const paired = new Set<number>();
  for (let index = 0; index < content.length; index += 1) {
    if (isPairedTextBlock(content, index, options)) paired.add(index);
  }
  return paired;
}

export function toStructuredToolResultText(
  content: ModelMessageContent,
  options: Pick<ToolResultMediaProjectionOptions, "inputFormat"> = {},
): string {
  if (typeof content === "string") return content;
  const paired = pairedTextIndexes(content, options);
  return modelMessageContentToText(
    content.map((block, index) => {
      if (paired.has(index)) return { type: "text", text: "" };
      const unsupportedText = unsupportedInputMediaText(block, options.inputFormat);
      return unsupportedText ? { type: "text", text: unsupportedText } : block;
    }),
  );
}

export function toToolResultMediaUserParts(
  content: ModelMessageContent,
  options: ToolResultMediaProjectionOptions,
): AiSdkUserContentParts {
  if (typeof content === "string" || options.stripMedia) return [];
  const blocks = content;
  const paired = pairedTextIndexes(blocks, options);

  const parts: AiSdkUserContentParts = [
    {
      type: "text",
      text: `${TOOL_RESULT_MEDIA_INTRO_PREFIX} ${options.toolName}:`,
    },
  ];
  let lastPushedWasPairedText = false;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    if (block.type === "text" && paired.has(index)) {
      if (lastPushedWasPairedText) parts.push({ type: "text", text: "\n\n" });
      parts.push({ type: "text", text: block.text });
      lastPushedWasPairedText = true;
      continue;
    }
    const mediaParts = contentBlockToUserMediaParts(block, options);
    if (mediaParts.length === 0) continue;
    parts.push(...mediaParts);
    lastPushedWasPairedText = false;
  }
  return parts.length > 1 ? parts : [];
}

function contentBlockToUserMediaParts(
  block: ModelMessageContentBlock,
  options: ToolResultMediaProjectionOptions,
): AiSdkUserContentParts {
  switch (block.type) {
    case "image": {
      if (options.inputFormat && getUnsupportedModelInputMediaKind(block, options.inputFormat)) {
        return [];
      }
      const data = dataUrlToDataContent(block.dataUrl);
      if (!data) return [];
      return [{ type: "image", image: data.data, mediaType: block.mediaType }];
    }

    case "video": {
      if (options.inputFormat && getUnsupportedModelInputMediaKind(block, options.inputFormat)) {
        return [];
      }
      const data = dataUrlToDataContent(block.dataUrl);
      if (!data) return [];
      return [{ type: "file", data: data.data, mediaType: block.mediaType }];
    }

    default:
      return [];
  }
}

export function undeliverableFrameReferenceText(
  content: ModelMessageContent,
  options: Pick<ToolResultMediaProjectionOptions, "stripMedia" | "inputFormat">,
): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const frameReferenceIndexes = content.flatMap((block, index) =>
    block.type === "text" && containsOfficialCuaImageRefCredentialText(block.text) ? [index] : [],
  );
  if (frameReferenceIndexes.length === 0) return undefined;
  const unavailable =
    "This tool returned a coordinate frame reference without a deliverable raster. " +
    "No image_ref or raster was exposed; do not use frame-bound coordinates. " +
    "Switch to an image-capable model and capture a new raster first.";
  if (options.stripMedia === true) return unavailable;
  return frameReferenceIndexes.every((index) => isPairedTextBlock(content, index, options))
    ? undefined
    : unavailable;
}
