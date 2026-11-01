import type { IFileService } from "@origin-ai/cf-services";
import { WORKSPACE_FILE_ENTRIES_CHUNK_SIZE } from "@origin-ai/cf-shared/workspaceFileEntriesCodec";

export async function fetchWorkspaceFileEntriesPacked(
  fileService: Pick<IFileService, "listWorkspaceFilesLength" | "listWorkspaceFilesRange">,
  rootPath: string,
): Promise<string> {
  const totalLength = await fileService.listWorkspaceFilesLength({ rootPath });
  let packed = "";
  for (let offset = 0; offset < totalLength; offset += WORKSPACE_FILE_ENTRIES_CHUNK_SIZE) {
    const chunk = await fileService.listWorkspaceFilesRange({
      rootPath,
      offset,
      length: WORKSPACE_FILE_ENTRIES_CHUNK_SIZE,
    });
    packed += chunk;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return packed;
}
