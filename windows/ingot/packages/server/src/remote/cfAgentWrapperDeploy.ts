import { writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IRemoteBackend } from "@origin-ai/cf-server/remote/backend.js";
import {
  buildRemoteExecutableReplaceCommand,
  waitForClose,
} from "@origin-ai/cf-server/remote/deployShared.js";
import { buildWriteLiteralFileCommand } from "@origin-ai/cf-server/remote/posixShell.js";

export function isWslBackend(backend: IRemoteBackend): boolean {
  return (backend as { kind?: string }).kind === "wsl";
}

export async function deployRemoteAgentWrapper(params: {
  backend: IRemoteBackend;
  content: string;
  remoteWrapperPath: string;
}): Promise<void> {
  const remoteWrapperTempPath = `${params.remoteWrapperPath}.new`;
  if (isWslBackend(params.backend)) {
    const localTempPath = join(tmpdir(), `cf-agent-wrapper-${process.pid}-${Date.now()}.sh`);
    try {
      await writeFile(localTempPath, params.content, "utf8");
      await params.backend.upload(localTempPath, remoteWrapperTempPath);
      const replaceStream = await params.backend.exec(
        buildRemoteExecutableReplaceCommand(remoteWrapperTempPath, params.remoteWrapperPath),
      );
      await waitForClose(replaceStream);
    } finally {
      await rm(localTempPath, { force: true });
    }
    return;
  }

  const stream = await params.backend.exec(
    [
      buildWriteLiteralFileCommand(remoteWrapperTempPath, params.content),
      buildRemoteExecutableReplaceCommand(remoteWrapperTempPath, params.remoteWrapperPath),
    ].join(" && "),
  );
  await waitForClose(stream);
}
