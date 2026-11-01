import type { Locale } from "@origin-ai/cf-shared";
import type { McpAppsResourcePermission } from "@origin-ai/cf-shared/mcp-apps";
import { PLUGIN_SANDBOX_SCHEME } from "./contract.js";

export type PluginSandboxPromptedPermission = Exclude<McpAppsResourcePermission, "clipboardWrite">;
export type PluginSandboxPermissionDecision = "allow" | "deny" | "prompt";

const PROMPTED: ReadonlySet<McpAppsResourcePermission> = new Set([
  "camera",
  "microphone",
  "geolocation",
]);
const PLUGIN_HOST_PREFIX = "plugin-";

export function resolvePluginSandboxRequestedPermissions(
  permission: string,
  details: { mediaTypes?: readonly string[] } | undefined,
): McpAppsResourcePermission[] | null {
  if (permission === "geolocation") return ["geolocation"];
  if (permission === "clipboard-sanitized-write" || permission === "clipboard-write") {
    return ["clipboardWrite"];
  }
  if (permission !== "media") return null;
  const types = details?.mediaTypes?.length ? details.mediaTypes : ["video", "audio"];
  const result: McpAppsResourcePermission[] = [];
  if (types.includes("video")) result.push("camera");
  if (types.includes("audio")) result.push("microphone");
  return result.length > 0 ? result : null;
}

export function resolvePluginSandboxCheckedPermission(
  permission: string,
  details: { mediaType?: string } | undefined,
): McpAppsResourcePermission | null {
  if (permission === "media") {
    if (details?.mediaType === "video") return "camera";
    if (details?.mediaType === "audio") return "microphone";
    return null;
  }
  return resolvePluginSandboxRequestedPermissions(permission, undefined)?.[0] ?? null;
}

export function decidePluginSandboxPermission(input: {
  requested: readonly McpAppsResourcePermission[];
  declared: readonly McpAppsResourcePermission[];
  consented: ReadonlySet<McpAppsResourcePermission>;
}): { decision: PluginSandboxPermissionDecision; pending: PluginSandboxPromptedPermission[] } {
  if (input.requested.length === 0) return { decision: "deny", pending: [] };
  if (input.requested.some((permission) => !input.declared.includes(permission))) {
    return { decision: "deny", pending: [] };
  }
  const pending = input.requested.filter(
    (permission): permission is PluginSandboxPromptedPermission =>
      PROMPTED.has(permission) && !input.consented.has(permission),
  );
  return pending.length > 0 ? { decision: "prompt", pending } : { decision: "allow", pending: [] };
}

export function isPluginSandboxPermissionGranted(input: {
  permission: McpAppsResourcePermission;
  declared: readonly McpAppsResourcePermission[];
  consented: ReadonlySet<McpAppsResourcePermission>;
}): boolean {
  if (!input.declared.includes(input.permission)) return false;
  return !PROMPTED.has(input.permission) || input.consented.has(input.permission);
}

export function readPluginSandboxIdFromPluginUrl(url: string | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${PLUGIN_SANDBOX_SCHEME}:`) return null;
  if (!parsed.hostname.startsWith(PLUGIN_HOST_PREFIX)) return null;
  const sandboxId = parsed.pathname.startsWith("/instance/")
    ? (parsed.pathname.split("/")[2] ?? "")
    : "";
  return sandboxId.length > 0 ? sandboxId : null;
}

export interface PluginSandboxPermissionDialogText {
  title: string;
  message: string;
  detail: string;
  allowButton: string;
  denyButton: string;
}

const PERMISSION_LABELS: Record<"zh" | "en", Record<PluginSandboxPromptedPermission, string>> = {
  zh: { camera: "摄像头", microphone: "麦克风", geolocation: "位置" },
  en: { camera: "camera", microphone: "microphone", geolocation: "location" },
};

export function formatPluginSandboxPermissionDialogText(
  input: { serverName: string; permissions: readonly PluginSandboxPromptedPermission[] },
  locale: Locale,
): PluginSandboxPermissionDialogText {
  if (locale === "zh-CN") {
    const list = input.permissions.map((permission) => PERMISSION_LABELS.zh[permission]).join("、");
    return {
      title: "应用权限请求",
      message: `「${input.serverName}」的应用Request使用${list}`,
      detail:
        "This page runs in CodeFusion's sandbox. Once allowed, apps from this MCP server can continue using these permissions during this session; you will be asked again after restarting the desktop app.",
      allowButton: "允许",
      denyButton: "拒绝",
    };
  }
  const list = input.permissions.map((permission) => PERMISSION_LABELS.en[permission]).join(", ");
  return {
    title: "App permission request",
    message: `The "${input.serverName}" app wants to use your ${list}`,
    detail:
      "This page runs in the CodeFusion sandbox. If you allow it, apps from this MCP server can keep using these permissions until CodeFusion restarts.",
    allowButton: "Allow",
    denyButton: "Deny",
  };
}
