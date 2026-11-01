import type { WindowHostAttachmentScope } from "@origin-ai/cf-shared";

export function bindBotGroupTaskScope<T extends object>(
  params: T,
  scope: WindowHostAttachmentScope,
): T {
  if (scope.kind === "source-settings") {
    throw new Error("Source settings attachment does not provide bot task routing");
  }
  return scope.kind === "local"
    ? params
    : {
        ...params,
        workspacePath: scope.workspacePath,
        workspaceIdentity: scope.workspaceIdentity,
        remoteSessionId: scope.remoteSessionId,
      };
}
