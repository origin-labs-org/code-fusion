import type { McpAppsDownloadFileItem } from "@origin-ai/cf-shared/mcp-apps";

export interface PluginUiDownloadPlan {
  name: string;
  mimeType: string | undefined;
  source:
    | { kind: "text"; text: string }
    | { kind: "blob"; blob: string }
    | { kind: "uri"; uri: string };
}

const MIME_EXTENSIONS: Record<string, string> = {
  "text/plain": "txt",
  "text/csv": "csv",
  "text/html": "html",
  "text/markdown": "md",
  "application/json": "json",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/gif": "gif",
};

function essence(mimeType: string | undefined): string | undefined {
  const value = mimeType?.split(";")[0]?.trim().toLowerCase();
  return value || undefined;
}

function lastPathSegment(uri: string): string {
  const withoutQuery = uri.split(/[?#]/)[0] ?? "";
  const segment = withoutQuery.split("/").filter(Boolean).at(-1) ?? "";
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function sanitizePluginUiDownloadFileName(name: string): string {
  return name
    .replace(/[\\/\u0000-\u001f]/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
}

export function resolvePluginUiDownloadFileName(
  input: { name?: string; uri?: string; mimeType?: string },
  index: number,
): string {
  const base = sanitizePluginUiDownloadFileName(
    input.name?.trim() || (input.uri ? lastPathSegment(input.uri) : "") || `download-${index + 1}`,
  );
  const extension = MIME_EXTENSIONS[essence(input.mimeType) ?? ""];
  return extension && !/\.[A-Za-z0-9]{1,8}$/.test(base) ? `${base}.${extension}` : base;
}

export function planPluginUiDownload(
  item: McpAppsDownloadFileItem,
  index: number,
): PluginUiDownloadPlan {
  if (item.type === "resource_link") {
    return {
      name: resolvePluginUiDownloadFileName(item, index),
      mimeType: item.mimeType,
      source: { kind: "uri", uri: item.uri },
    };
  }
  const resource = item.resource;
  const name = resolvePluginUiDownloadFileName(
    { name: resource.name, uri: resource.uri, mimeType: resource.mimeType },
    index,
  );
  if (typeof resource.text === "string") {
    return { name, mimeType: resource.mimeType, source: { kind: "text", text: resource.text } };
  }
  if (typeof resource.blob === "string") {
    return { name, mimeType: resource.mimeType, source: { kind: "blob", blob: resource.blob } };
  }
  return { name, mimeType: resource.mimeType, source: { kind: "uri", uri: resource.uri } };
}

export function decodedBase64Length(value: string): number {
  const trimmed = value.replace(/\s+/g, "");
  if (trimmed.length === 0) return 0;
  const padding = trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0;
  return Math.floor((trimmed.length * 3) / 4) - padding;
}
