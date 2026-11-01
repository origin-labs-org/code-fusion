import { METHOD_NOT_FOUND, ProtocolError } from "@modelcontextprotocol/client";
import { EmptyResultSchema } from "@modelcontextprotocol/core";
import { McpUiMessageResultSchema } from "@modelcontextprotocol/ext-apps/app-bridge";
import type {
  McpAppsDownloadFileItem,
  PluginSandboxHandle,
  PluginSandboxPlatformPort,
} from "@origin-ai/cf-shared/mcp-apps";
import { MCP_APPS_SET_WIDGET_STATE_METHOD, concatMcpAppsTextContent } from "@origin-ai/cf-shared/mcp-apps";
import { z } from "zod";
import type { PluginUiHostBridge } from "./pluginUiHostBridge.js";

export interface PluginUiInteractionCallbacks {
  
  onSendFollowUpMessage?(
    payload: {
      prompt: string;
      content?: Array<Record<string, unknown>>;
      structuredContent?: unknown;
    },
    context: { consumeUserGesture(): Promise<boolean>; assertCurrent(): void },
  ): Promise<void>;
  onUpdateModelContext?(payload: {
    content: Array<Record<string, unknown>>;
    structuredContent?: unknown;
  }): Promise<void>;
  
  onUpdateWidgetState?(widgetState: unknown): Promise<void>;
  
  onDownloadFile?(contents: McpAppsDownloadFileItem[]): Promise<{ isError?: boolean }>;
}

const pluginUiMessageParamsSchema = z
  .object({
    role: z.literal("user"),
    content: z.array(z.record(z.string(), z.unknown())).min(1),
    structuredContent: z.unknown().optional(),
  })
  .loose();
const pluginUiSetWidgetStateParamsSchema = z.object({ widgetState: z.unknown() }).loose();

function toProtocolError(error: unknown): unknown {
  const code = (error as { code?: unknown } | null)?.code;
  if (error instanceof ProtocolError) return error;
  if (error instanceof Error && typeof code === "number")
    return new ProtocolError(code, error.message);
  return error;
}
const unsupported = (method: string) =>
  new ProtocolError(METHOD_NOT_FOUND, `${method} is not available for this app`);

export function wirePluginUiInteractions(
  bridge: PluginUiHostBridge,
  deps: PluginUiInteractionCallbacks,
  platform: Pick<PluginSandboxPlatformPort, "consumeUserGesture">,
  currentHandle: () => PluginSandboxHandle | null,
): void {
  bridge.setRequestHandler(
    "ui/message",
    { params: pluginUiMessageParamsSchema, result: McpUiMessageResultSchema },
    async (rawParams) => {
      if (!deps.onSendFollowUpMessage) throw unsupported("ui/message");
      const params = rawParams as z.infer<typeof pluginUiMessageParamsSchema>;
      const handle = currentHandle();
      const assertCurrent = () => {
        if (!handle || currentHandle()?.instance.token !== handle.instance.token)
          throw new Error("MCP App instance was closed");
      };
      assertCurrent();
      try {
        await deps.onSendFollowUpMessage(
          {
            prompt: concatMcpAppsTextContent(params.content),
            content: params.content,
            ...(params.structuredContent !== undefined
              ? { structuredContent: params.structuredContent }
              : {}),
          },
          {
            assertCurrent,
            consumeUserGesture: () =>
              handle ? platform.consumeUserGesture(handle.sandboxId) : Promise.resolve(false),
          },
        );
      } catch (error) {
        throw toProtocolError(error);
      }
      return {};
    },
  );
  bridge.onupdatemodelcontext = async (params) => {
    if (!currentHandle()) throw new Error("MCP App instance was closed");
    if (!deps.onUpdateModelContext) throw unsupported("ui/update-model-context");
    try {
      await deps.onUpdateModelContext({
        content: (params.content ?? []) as Array<Record<string, unknown>>,
        ...(params.structuredContent !== undefined
          ? { structuredContent: params.structuredContent }
          : {}),
      });
    } catch (error) {
      throw toProtocolError(error);
    }
    return {};
  };
  bridge.ondownloadfile = async (params) => {
    if (!deps.onDownloadFile) throw unsupported("ui/download-file");
    try {
      return await deps.onDownloadFile(params.contents as McpAppsDownloadFileItem[]);
    } catch (error) {
      throw toProtocolError(error);
    }
  };
  bridge.setRequestHandler(
    MCP_APPS_SET_WIDGET_STATE_METHOD,
    { params: pluginUiSetWidgetStateParamsSchema, result: EmptyResultSchema },
    async (rawParams) => {
      if (!currentHandle()) throw new Error("MCP App instance was closed");
      if (!deps.onUpdateWidgetState) throw unsupported(MCP_APPS_SET_WIDGET_STATE_METHOD);
      const params = rawParams as z.infer<typeof pluginUiSetWidgetStateParamsSchema>;
      await deps.onUpdateWidgetState(params.widgetState);
      return {};
    },
  );
}
