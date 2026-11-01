import { isPublicCfErrorCode } from "@origin-ai/cf-shared";
export const REMOTE_WORKSPACE_DISCONNECTED_ERROR_CODE = "CF_REMOTE_WORKSPACE_DISCONNECTED";

export function createRemoteWorkspaceDisconnectedError(): Error & {
  code: typeof REMOTE_WORKSPACE_DISCONNECTED_ERROR_CODE;
} {
  const error = new Error(REMOTE_WORKSPACE_DISCONNECTED_ERROR_CODE) as Error & {
    code: typeof REMOTE_WORKSPACE_DISCONNECTED_ERROR_CODE;
  };
  error.code = REMOTE_WORKSPACE_DISCONNECTED_ERROR_CODE;
  return error;
}

export function isRemoteWorkspaceDisconnectedError(error: unknown): boolean {
  if (error === REMOTE_WORKSPACE_DISCONNECTED_ERROR_CODE) {
    return true;
  }

  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === REMOTE_WORKSPACE_DISCONNECTED_ERROR_CODE ||
    candidate.message === REMOTE_WORKSPACE_DISCONNECTED_ERROR_CODE
  );
}

export function getRemoteConnectionFailureCode(error: unknown): string | undefined {
  if (isRemoteWorkspaceDisconnectedError(error)) return REMOTE_WORKSPACE_DISCONNECTED_ERROR_CODE;
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string")
    return undefined;
  return isPublicCfErrorCode(error.code) ? error.code : undefined;
}
