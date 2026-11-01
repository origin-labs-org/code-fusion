
import {
  cfOfficialMcpAuthHeadersResponseSchema,
  cfProtocolMethods,
  type CfWorkspaceRef,
} from "@origin-ai/cf-shared";
import type { OfficialMcpAuthHeadersPort } from "@origin-ai/cf-contracts";
import type { CfProtocolAgentServerContext } from "./server-types.js";

let requestSequence = 0;

export type OfficialMcpAuthRequestContext = Pick<
  CfProtocolAgentServerContext,
  "requestClient"
>;

export function createOfficialMcpAuthHeadersPort(input: {
  resolveContext: () => OfficialMcpAuthRequestContext | undefined;
  resolveWorkspace: (input: {
    workspaceIdentity?: string;
    workspacePath?: string;
  }) => CfWorkspaceRef | undefined;
}): OfficialMcpAuthHeadersPort {
  return {
    async resolveHeaders(request) {
      const context = input.resolveContext();
      const workspace = input.resolveWorkspace({
        ...(request.workspaceIdentity ? { workspaceIdentity: request.workspaceIdentity } : {}),
        ...(request.workspacePath ? { workspacePath: request.workspacePath } : {}),
      });
      if (!context || !workspace) {
        return { ok: false, reason: "official_auth_unavailable" };
      }
      requestSequence += 1;
      try {
        return await context.requestClient(
          cfProtocolMethods.interactionRequestOfficialMcpAuthHeaders,
          {
            mcpKey: request.mcpKey,
            pluginId: request.pluginId,
            requestId: `official-mcp-auth:${requestSequence}`,
            targetOrigin: request.targetOrigin,
            workspace,
          },
          cfOfficialMcpAuthHeadersResponseSchema,
          request.signal ? { signal: request.signal } : {},
        );
      } catch {
        return { ok: false, reason: "official_auth_unavailable" };
      }
    },
  };
}
