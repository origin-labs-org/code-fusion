import type { McpServerConfig, CfMcpServer } from "@origin-ai/cf-shared";

export const MCP_SECTIONS = ["cfagentmcp"] as const;

export type ServerScope = (typeof MCP_SECTIONS)[number];

export const SOURCE_META: Record<
  ServerScope,
  { label: string; section: string; badgeClass: string }
> = {
  cfagentmcp: {
    label: "CodeFusion Agent",
    section: "CodeFusion Agent",
    badgeClass: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
  },
};
export type ConfigStorageLevel = "user" | "workspace";
export type McpEditorMode = "form" | "json";

export interface FormState {
  name: string;
  scope: ServerScope;
  storageLevel: ConfigStorageLevel;
  type: "stdio" | "http" | "sse" | "streamableHttp";
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
  timeoutMs: string;
  oauth?: string;
  protocolVersion: string;
}

export const EMPTY_FORM: FormState = {
  name: "",
  scope: "cfagentmcp",
  storageLevel: "user",
  type: "stdio",
  command: "",
  args: "",
  env: "",
  url: "",
  headers: "",
  timeoutMs: "",
  oauth: "",
  protocolVersion: "",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function serverToForm(server: CfMcpServer): FormState {
  const cfg = server.config;
  let type: FormState["type"];
  if (cfg.type === "sse") {
    type = "sse";
  } else if (cfg.type === "streamableHttp") {
    type = "streamableHttp";
  } else if (cfg.command) {
    type = "stdio";
  } else {
    type = "http";
  }
  return {
    name: server.name,
    scope: "cfagentmcp",
    storageLevel: server.scope === "workspace" ? "workspace" : "user",
    type,
    command: cfg.command ?? "",
    args: (cfg.args ?? []).join(" "),
    env: cfg.env ? JSON.stringify(cfg.env, null, 2) : "",
    url: cfg.url ?? "",
    headers: cfg.headers ? JSON.stringify(cfg.headers, null, 2) : "",
    timeoutMs: typeof cfg.timeoutMs === "number" ? String(cfg.timeoutMs) : "",
    oauth: isRecord(cfg.oauth) ? JSON.stringify(cfg.oauth, null, 2) : "",
    protocolVersion: isMcpProtocolVersion(cfg.protocolVersion) ? cfg.protocolVersion : "",
  };
}

export function formToConfig(form: FormState): McpServerConfig {
  const timeoutMs = parseTimeoutMs(form.timeoutMs);
  if (form.type === "stdio") {
    let env: Record<string, string> | undefined;
    if (form.env.trim()) {
      try {
        env = JSON.parse(form.env) as Record<string, string>;
      } catch {
        // ignore invalid json until save validation
      }
    }

    return {
      type: "stdio",
      command: form.command,
      args: form.args.trim() ? form.args.trim().split(/\s+/) : [],
      env,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(form.protocolVersion
        ? { protocolVersion: form.protocolVersion as McpServerConfig["protocolVersion"] }
        : {}),
    };
  }

  let headers: Record<string, string> | undefined;
  if (form.headers.trim()) {
    try {
      headers = JSON.parse(form.headers) as Record<string, string>;
    } catch {
      // ignore invalid json until save validation
    }
  }

  let oauth: McpServerConfig["oauth"] | undefined;
  if (form.oauth?.trim()) {
    try {
      oauth = JSON.parse(form.oauth) as McpServerConfig["oauth"];
    } catch {
      // ignore invalid json until save validation
    }
  }

  return {
    type: form.type,
    url: form.url,
    headers,
    ...(oauth !== undefined ? { oauth } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(form.protocolVersion
      ? { protocolVersion: form.protocolVersion as McpServerConfig["protocolVersion"] }
      : {}),
  };
}

function parseTimeoutMs(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

export function formToJsonDraft(form: FormState): string {
  const fallbackName = form.name.trim() || "my-mcp-server";
  return JSON.stringify({ [fallbackName]: formToConfig(form) }, null, 2);
}

export function jsonDraftToForm(jsonText: string, fallback: FormState): FormState {
  const parsed = JSON.parse(jsonText) as unknown;

  let serverName = fallback.name.trim();
  let serverConfig: unknown = parsed;

  if (isRecord(parsed) && isRecord(parsed.mcpServers)) {
    const entries = Object.entries(parsed.mcpServers).filter(([, value]) => isRecord(value));
    if (entries.length !== 1) {
      throw new Error("JSON 模式暂时只支持一次编辑一个 MCP server");
    }
    const [singleName, singleConfig] = entries[0]!;
    serverName = singleName;
    serverConfig = singleConfig;
  } else if (isRecord(parsed)) {
    const entries = Object.entries(parsed).filter(([, value]) => isRecord(value));
    if (
      entries.length === 1 &&
      !("type" in parsed) &&
      !("command" in parsed) &&
      !("url" in parsed)
    ) {
      const [singleName, singleConfig] = entries[0]!;
      serverName = singleName;
      serverConfig = singleConfig;
    }
  }

  if (!isRecord(serverConfig)) {
    throw new Error("JSON 内容不是有效的 MCP server 配置对象");
  }

  if (!serverName) {
    throw new Error("JSON 模式需要提供 server 名称");
  }

  const normalizedConfig = serverConfig as McpServerConfig;
  let normalizedType: FormState["type"];
  if (normalizedConfig.type === "sse") {
    normalizedType = "sse";
  } else if (normalizedConfig.type === "streamableHttp") {
    normalizedType = "streamableHttp";
  } else if (normalizedConfig.command) {
    normalizedType = "stdio";
  } else {
    normalizedType = "http";
  }

  return {
    name: serverName,
    scope: fallback.scope,
    storageLevel: fallback.storageLevel,
    type: normalizedType,
    command: normalizedConfig.command ?? "",
    args: Array.isArray(normalizedConfig.args) ? normalizedConfig.args.join(" ") : "",
    env: normalizedConfig.env ? JSON.stringify(normalizedConfig.env, null, 2) : "",
    url: normalizedConfig.url ?? "",
    headers: normalizedConfig.headers ? JSON.stringify(normalizedConfig.headers, null, 2) : "",
    timeoutMs:
      typeof normalizedConfig.timeoutMs === "number" ? String(normalizedConfig.timeoutMs) : "",
    oauth: isRecord(normalizedConfig.oauth) ? JSON.stringify(normalizedConfig.oauth, null, 2) : "",
    protocolVersion: isMcpProtocolVersion(normalizedConfig.protocolVersion)
      ? normalizedConfig.protocolVersion
      : "",
  };
}

function isMcpProtocolVersion(value: unknown): value is "legacy" | "auto" | "2026-07-28" {
  return value === "legacy" || value === "auto" || value === "2026-07-28";
}
