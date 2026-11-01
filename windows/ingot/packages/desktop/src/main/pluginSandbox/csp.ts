import type {
  McpAppCspRelaxations,
  McpAppsResourcePermission,
  McpToolUiCsp,
} from "@origin-ai/cf-shared/mcp-apps";
import { normalizeCspOrigin } from "@origin-ai/cf-shared/mcp-apps";
import { buildPluginSandboxShellUrl } from "./contract.js";

export function buildPluginSandboxCsp(input: {
  csp?: McpToolUiCsp;
  cspRelaxations?: McpAppCspRelaxations;
  sandboxId: string;
  appIdentity: string;
}): string {
  const resource = normalizeOrigins(input.csp?.resourceDomains);
  const connect = normalizeOrigins(input.csp?.connectDomains);
  const frame = normalizeOrigins(input.csp?.frameDomains);
  const baseUri = normalizeOrigins(input.csp?.baseUriDomains);
  if (!PLUGIN_SANDBOX_CSP_HOST_SAFE_ID.test(input.sandboxId)) {
    throw new Error(`plugin sandbox id is not CSP host-safe: ${input.sandboxId}`);
  }
  const shellUrl = new URL(buildPluginSandboxShellUrl(input.sandboxId, input.appIdentity));
  const shellOrigin = `${shellUrl.protocol}//${shellUrl.host}`;
  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    "blob:",
    "data:",
    ...(input.cspRelaxations?.unsafeEval ? ["'unsafe-eval'"] : []),
    ...(input.cspRelaxations?.wasmUnsafeEval ? ["'wasm-unsafe-eval'"] : []),
    ...resource,
  ];
  return [
    "default-src 'none'",
    `script-src ${scriptSources.join(" ")}`,
    `style-src ${["'self'", "'unsafe-inline'", ...resource].join(" ")}`,
    `img-src ${["'self'", "data:", "blob:", ...resource].join(" ")}`,
    `media-src ${["'self'", "data:", "blob:", ...resource].join(" ")}`,
    `font-src ${["'self'", "data:", ...resource].join(" ")}`,
    `connect-src ${connect.length > 0 ? connect.join(" ") : "'none'"}`,
    `frame-src ${frame.length > 0 ? frame.join(" ") : "'none'"}`,
    `base-uri ${["'self'", ...baseUri].join(" ")}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    `frame-ancestors ${shellOrigin}`,
    "form-action 'none'",
  ].join("; ");
}

export const PLUGIN_SANDBOX_CSP_HOST_SAFE_ID = /^[A-Za-z0-9-]+$/;

export const PLUGIN_SANDBOX_SHELL_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "frame-src cf-sandbox:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'self'",
].join("; ");

export const PLUGIN_SANDBOX_PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "display-capture=()",
  "payment=()",
  "usb=()",
  "clipboard-read=()",
].join(", ");

export function buildPluginSandboxPermissionsPolicy(
  permissions: readonly McpAppsResourcePermission[] | undefined,
  document: "shell" | "plugin",
): string {
  const granted = new Set(permissions ?? []);
  const allow = document === "shell" ? "*" : "(self)";
  return [
    `camera=${granted.has("camera") ? allow : "()"}`,
    `microphone=${granted.has("microphone") ? allow : "()"}`,
    `geolocation=${granted.has("geolocation") ? allow : "()"}`,
    "display-capture=()",
    "payment=()",
    "usb=()",
    "clipboard-read=()",
  ].join(", ");
}

function normalizeOrigins(list: string[] | undefined): string[] {
  if (!list) return [];
  const origins = list
    .map(normalizeCspOrigin)
    .filter((origin): origin is string => origin !== null);
  return [...new Set(origins)];
}
