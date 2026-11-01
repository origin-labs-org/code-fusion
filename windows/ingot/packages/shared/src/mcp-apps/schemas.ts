import { z } from "zod";
import {
  MCP_APPS_RESOURCE_URI_MAX_CHARS,
  MCP_APPS_CONTENT_MAX_BYTES,
  MCP_APPS_STRUCTURED_CONTENT_MAX_BYTES,
  MCP_APPS_SURFACE_ID_MAX_CHARS,
  MCP_APPS_SURFACE_ID_PATTERN,
  MCP_APPS_WIDGET_META_MAX_BYTES,
} from "./contract.js";

export const mcpAppsDisplayModeSchema = z.enum(["inline", "fullscreen", "pip"]);
export const mcpAppsToolVisibilitySchema = z.enum(["model", "app"]);

export const mcpAppsSurfaceIdSchema = z
  .string()
  .min(1)
  .max(MCP_APPS_SURFACE_ID_MAX_CHARS)
  .regex(MCP_APPS_SURFACE_ID_PATTERN);

export const mcpToolUiCspSchema = z
  .object({
    connectDomains: z.array(z.string().min(1).max(512)).optional(),
    resourceDomains: z.array(z.string().min(1).max(512)).optional(),
    frameDomains: z.array(z.string().min(1).max(512)).optional(),
    baseUriDomains: z.array(z.string().min(1).max(512)).optional(),
  })
  .strict();

export const mcpAppCspRelaxationsSchema = z
  .object({ unsafeEval: z.boolean().optional(), wasmUnsafeEval: z.boolean().optional() })
  .strict();

export const mcpToolUiDescriptorSchema = z
  .object({
    resourceUri: z.string().min(1).max(MCP_APPS_RESOURCE_URI_MAX_CHARS),
    visibility: z.array(mcpAppsToolVisibilitySchema).optional(),
    preferredDisplayMode: mcpAppsDisplayModeSchema.optional(),
    csp: mcpToolUiCspSchema.optional(),
    prefersBorder: z.boolean().optional(),
    surface: mcpAppsSurfaceIdSchema.optional(),
    showInline: z.boolean().optional(),
  })
  .strict();

export const mcpToolDisplayUiSchema = z
  .object({
    pluginId: z.string().min(1).max(256),
    resourceUri: z.string().min(1).max(MCP_APPS_RESOURCE_URI_MAX_CHARS),
    preferredDisplayMode: mcpAppsDisplayModeSchema.optional(),
    prefersBorder: z.boolean().optional(),
    csp: mcpToolUiCspSchema.optional(),
    structuredContent: z.string().max(MCP_APPS_STRUCTURED_CONTENT_MAX_BYTES).optional(),
    widgetMeta: z.string().max(MCP_APPS_WIDGET_META_MAX_BYTES).optional(),
    
    content: z.string().max(MCP_APPS_CONTENT_MAX_BYTES).optional(),
    truncated: z.boolean().optional(),
    
    truncatedBytes: z.number().int().nonnegative().optional(),
    
    isError: z.literal(true).optional(),
    
    showInline: z.literal(true).optional(),
    surface: mcpAppsSurfaceIdSchema.optional(),
  })
  .strict();
export type McpToolDisplayUi = z.infer<typeof mcpToolDisplayUiSchema>;

export const pluginUiToolResultNotificationSchema = z
  .object({
    sessionId: z.string().min(1),
    toolCallId: z.string().min(1),
    serverName: z.string().min(1),
    ui: mcpToolDisplayUiSchema.refine((ui) => !ui.isError),
    input: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type PluginUiToolResultNotification = z.infer<typeof pluginUiToolResultNotificationSchema>;
