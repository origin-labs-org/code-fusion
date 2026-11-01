import { getPluginUiSessionActions } from "@/plugin-ui/adapters/pluginUiSessionActions.js";
import type { PluginUiHostControllerDeps } from "@/plugin-ui/app/pluginUiHostController.js";
import type { PluginUiScopeRef } from "@origin-ai/cf-shared/mcp-apps";
import { buildPluginSandboxScopeId, concatMcpAppsTextContent } from "@origin-ai/cf-shared/mcp-apps";
import { requestPluginUiFollowUpConfirmation } from "../app/pluginUiFollowUpDialogStore.js";
import {
  PLUGIN_UI_FOLLOW_UP_STRUCTURED_MAX_BYTES,
  buildPluginUiFollowUpPrompt,
} from "../domain/pluginUiFollowUp.js";
import { readPluginUiImageBlocks } from "../domain/pluginUiImageBlocks.js";
import { dispatchPluginUiModelContextAdd } from "./pluginUiModelContextEvents.js";

import { type PluginUiSessionScope } from "@/plugin-ui/contract.js";

export interface PluginUiInteractionScope extends PluginUiSessionScope {
  sessionId: string;
  pluginId: string;
  
  scope: PluginUiScopeRef;
}

const JSON_RPC_UNAVAILABLE = -32601;
const JSON_RPC_CANCELLED = -32000;

function rpcError(code: number, message: string): Error & { code: number } {
  return Object.assign(new Error(message), { code });
}

function readImagesOrThrow(content: readonly Record<string, unknown>[] | undefined) {
  const images = readPluginUiImageBlocks(content);
  if (images.ok) return images.images;
  const detail =
    images.reason === "too_large"
      ? `image exceeds 4 MiB (${images.bytes} bytes)`
      : images.reason === "unsupported_mime"
        ? `unsupported image mimeType ${images.mimeType ?? "(missing)"}; use png / jpeg / webp`
        : "image block must carry base64 data and mimeType";
  throw rpcError(-32602, `unsupported_content: ${detail}`);
}

function scopeMarker(scope: PluginUiScopeRef): string {
  return scope.kind === "toolCall" ? scope.toolCallId : buildPluginSandboxScopeId(scope);
}

export function createPluginUiInteractions(
  input: PluginUiInteractionScope,
): Pick<PluginUiHostControllerDeps, "onSendFollowUpMessage" | "onUpdateModelContext"> {
  const marker = scopeMarker(input.scope);
  const source = { kind: "pluginUi" as const, pluginId: input.pluginId, toolCallId: marker };
  return {
    async onSendFollowUpMessage(payload, context) {
      const actions = getPluginUiSessionActions(input);
      if (!actions)
        throw rpcError(JSON_RPC_UNAVAILABLE, "Follow-up messages are not available here");
      const built = buildPluginUiFollowUpPrompt(payload.prompt, payload.structuredContent);
      if (!built.ok) {
        throw rpcError(
          -32602,
          built.reason === "empty_prompt"
            ? "prompt must not be empty"
            : `structuredContent exceeds ${PLUGIN_UI_FOLLOW_UP_STRUCTURED_MAX_BYTES} bytes (${built.bytes})`,
        );
      }
      let prompt = built.prompt;
      const images = readImagesOrThrow(payload.content);
      const gesture = await context.consumeUserGesture();
      if (!gesture) {
        const confirmed = await requestPluginUiFollowUpConfirmation({
          pluginId: input.pluginId,
          prompt,
        });
        if (confirmed === null || !confirmed.trim()) {
          throw rpcError(JSON_RPC_CANCELLED, "User cancelled the follow-up message");
        }
        prompt = confirmed.trim();
      }
      if (getPluginUiSessionActions(input) !== actions)
        throw rpcError(JSON_RPC_UNAVAILABLE, "Session binding is no longer available");
      context.assertCurrent();
      await actions.sendFollowUp({ prompt, source, ...(images.length > 0 ? { images } : {}) });
    },
    async onUpdateModelContext(payload) {
      const text = concatMcpAppsTextContent(payload.content);
      const images = readImagesOrThrow(payload.content);
      const delivered = dispatchPluginUiModelContextAdd(input, {
        id: `plugin-ui-context:${input.pluginId}:${marker}`,
        sessionId: input.sessionId,
        pluginId: input.pluginId,
        toolCallId: marker,
        text,
        ...(payload.structuredContent !== undefined
          ? { structuredContent: payload.structuredContent }
          : {}),
        ...(images.length > 0 ? { images } : {}),
      });
      if (!delivered)
        throw rpcError(JSON_RPC_UNAVAILABLE, "No composer is listening for model context");
    },
  };
}
