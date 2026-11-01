const CF_PROCESS_PREFIX = "cf";
const MAX_PROCESS_NAME_SEGMENT_LENGTH = 24;

function sanitizeProcessNameSegment(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, MAX_PROCESS_NAME_SEGMENT_LENGTH);
}

function joinCfProcessName(...segments: Array<string | null | undefined>): string {
  const sanitizedSegments = segments
    .map((segment) => sanitizeProcessNameSegment(segment))
    .filter((segment): segment is string => Boolean(segment));
  return [CF_PROCESS_PREFIX, ...sanitizedSegments].join("-");
}

function pickWorkspaceTag(workspacePath: string | null | undefined): string | undefined {
  const trimmedPath = workspacePath?.trim();
  if (!trimmedPath) {
    return undefined;
  }

  const parts = trimmedPath.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? trimmedPath;
}

export function formatCfMainProcessName(): string {
  return joinCfProcessName("main");
}

export function formatCfGpuProcessName(): string {
  return joinCfProcessName("gpu");
}

export function formatCfHostProcessName(label?: string): string {
  return joinCfProcessName("host", label);
}

export function formatCfRendererProcessName(windowTitle?: string): string {
  const normalizedTitle = windowTitle?.trim();
  if (!normalizedTitle || normalizedTitle === "CodeFusion") {
    return joinCfProcessName("renderer", "main");
  }

  if (normalizedTitle === "Resource Manager") {
    return joinCfProcessName("renderer", "resource-manager");
  }

  const remoteWindowPrefix = "CodeFusion - ";
  if (normalizedTitle.startsWith(remoteWindowPrefix)) {
    return joinCfProcessName(
      "renderer",
      "remote",
      normalizedTitle.slice(remoteWindowPrefix.length),
    );
  }

  return joinCfProcessName("renderer", normalizedTitle);
}

export function formatCfAgentProcessName(provider: string, workspacePath?: string): string {
  return joinCfProcessName("agent", provider, pickWorkspaceTag(workspacePath));
}

export function formatCfUtilityProcessName(name?: string, type = "utility"): string {
  return joinCfProcessName(type, name);
}
