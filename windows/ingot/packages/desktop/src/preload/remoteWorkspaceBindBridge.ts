import type {
  BindRemoteWorkspaceSessionContextIpcResult,
  BindRemoteWorkspaceSessionContextResult,
} from "@origin-ai/cf-shared";

export function unwrapRemoteWorkspaceBindResult(
  result: BindRemoteWorkspaceSessionContextIpcResult,
): BindRemoteWorkspaceSessionContextResult {
  if (result.success) return result.result;
  const error = new Error(result.error) as Error & { code?: string; retryable?: boolean };
  if (result.reasonCode) error.code = result.reasonCode;
  if (result.retryable !== undefined) error.retryable = result.retryable;
  throw error;
}
