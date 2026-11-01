import type { IServiceAccessor } from "@origin-ai/cf-services";
import { isRemoteWorkspaceIdentity, type IPlatformService } from "@origin-ai/cf-shared";
import { logger } from "@/logger.js";
import { buildPluginUiSurfaceKey } from "@/plugin-ui/contract.js";
import { resolvePluginUiLogicalScope } from "@/plugin-ui/domain/pluginUiLogicalScope.js";
import { buildPluginUiToolResult } from "@/plugin-ui/domain/pluginUiToolFeed.js";
import { createPage } from "@/plugin-ui/adapters/pluginUiManagedPage.js";
import { acquirePluginUiPage } from "@/plugin-ui/adapters/pluginUiPageRegistry.js";
import type { UsePluginUiHostInput } from "@/plugin-ui/adapters/pluginUiHostTypes.js";

export function attachPluginUiToolResults(
  services: IServiceAccessor,
  platform: IPlatformService,
  settings: () => Pick<UsePluginUiHostInput, "theme" | "locale">,
): () => void {
  if (!platform.pluginSandbox || !services.pluginUiBridgeService) return () => {};
  let disposed = false;
  const subscription = services.cfAgentService.onDynamicPluginUiToolResult()((result) => {
    if (disposed || isRemoteWorkspaceIdentity(result.workspaceIdentity ?? "")) return;
    const presentation = { ...result.ui, serverName: result.serverName };
    const scope = {
      workspacePath: result.workspacePath,
      workspaceIdentity: result.workspaceIdentity,
      sessionId: result.sessionId,
      scope: resolvePluginUiLogicalScope(presentation, {
        kind: "toolCall",
        toolCallId: result.toolCallId,
      }),
    };
    const input: UsePluginUiHostInput = {
      ...settings(),
      presentation,
      scope,
      displayMode: "inline",
      width: 0,
      hostVersion: "cf",
      toolCallId: result.toolCallId,
      toolInput: result.input,
      toolResult: buildPluginUiToolResult(
        { status: "completed", input: result.input },
        presentation,
      ),
    };
    const key = buildPluginUiSurfaceKey({ ...scope, ...presentation }, scope.scope);
    void acquirePluginUiPage(key, () => createPage(key, input, platform, services)).then(
      (page) => {
        if (!disposed) page.updateToolFeed(input);
      },
      (error) =>
        logger.warn("[plugin-ui] background admission failed", {
          sessionId: result.sessionId,
          pluginId: presentation.pluginId,
          error: String(error),
        }),
    );
  });
  return () => {
    disposed = true;
    subscription.dispose();
  };
}
