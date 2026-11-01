import { isNonRetryableWorkspacePrepareError, type CfProvider } from "@origin-ai/cf-shared";

export function shouldAutoRetryWorkspacePrepare(errorMessage: string) {
  return !isNonRetryableWorkspacePrepareError(errorMessage);
}

export function shouldRestartWorkspaceProcessBeforePrepareRetry(_params: {
  provider: CfProvider;
  errorMessage: string;
}): boolean {
  return false;
}
