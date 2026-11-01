import type { IFileService } from "@origin-ai/cf-services";
import { REMOTE_WORKSPACE_DIRECTORY_UNAVAILABLE_ERROR_CODE } from "@origin-ai/cf-shared";

interface RemoteWorkspaceIdentityInput {
  workspacePath: string;
  stableWorkspaceIdentity: string;
  legacyRouteHint?: string;
  signal?: AbortSignal;
}

export async function prepareRemoteWorkspaceIdentity(
  fileService: Pick<IFileService, "readdir">,
  input: RemoteWorkspaceIdentityInput,
  bindWorkspaceIdentity?: (input: RemoteWorkspaceIdentityInput) => Promise<void>,
): Promise<void> {
  input.signal?.throwIfAborted();
  const unavailable = () =>
    Object.assign(
      new Error(
        `Remote workspace directory is missing, is not a directory, or cannot be accessed: ${input.workspacePath}`,
      ),
      { code: REMOTE_WORKSPACE_DIRECTORY_UNAVAILABLE_ERROR_CODE, retryable: false },
    );
  try {
    await fileService.readdir({ path: `${input.workspacePath}/.` });
  } catch (error) {
    input.signal?.throwIfAborted();
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      ["ENOENT", "ENOTDIR", "EACCES", "EPERM", "ELOOP"].includes(String(error.code))
    ) {
      throw unavailable();
    }
    throw error;
  }
  input.signal?.throwIfAborted();
  await bindWorkspaceIdentity?.(input);
  input.signal?.throwIfAborted();
}
