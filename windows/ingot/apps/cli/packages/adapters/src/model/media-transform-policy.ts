import {
  createUnsupportedModelInputMediaText,
  getUnsupportedModelInputMediaKind,
  type ModelInputFormat,
  type ModelMessageContentBlock,
} from "@origin-ai/cf-contracts";

export function unsupportedInputMediaText(
  block: ModelMessageContentBlock,
  inputFormat: ModelInputFormat | undefined,
): string | undefined {
  if (!inputFormat) return undefined;
  const unsupportedKind = getUnsupportedModelInputMediaKind(block, inputFormat);
  return unsupportedKind ? createUnsupportedModelInputMediaText(block, unsupportedKind) : undefined;
}

export function dataUrlToDataContent(
  dataUrl: string,
): { mediaType: string; data: string } | undefined {
  const commaIndex = dataUrl.indexOf(",");
  if (dataUrl.slice(0, "data:".length).toLowerCase() !== "data:" || commaIndex < 0) {
    return undefined;
  }
  const headerParts = dataUrl.slice("data:".length, commaIndex).split(";");
  const mediaType = headerParts.shift()?.trim();
  if (headerParts.at(-1)?.trim().toLowerCase() !== "base64" || !mediaType) return undefined;
  const data = dataUrl.slice(commaIndex + 1);
  if (data.length === 0) return undefined;
  return { mediaType: mediaType.toLowerCase(), data };
}
