import { CF_AGENT_PROVIDER } from "@origin-ai/cf-shared";
import type { IRemoteBackend } from "@origin-ai/cf-server/remote/backend.js";
import { type DeployLoggers, waitForClose } from "@origin-ai/cf-server/remote/deployShared.js";
import { quotePosixPathArg } from "@origin-ai/cf-server/remote/posixShell.js";

export async function repairLegacyRemoteOfficialPluginDirectoryPermissions(params: {
  backend: IRemoteBackend;
  loggers: DeployLoggers;
  remoteOfficialPluginDir: string;
}): Promise<boolean> {
  params.loggers.logWarn(
    `[cf-agent-deploy] ${CF_AGENT_PROVIDER}: Check并修复Old builtin plugin Table of ContentsPermissions ${params.remoteOfficialPluginDir}`,
  );
  const quotedRemoteOfficialPluginDir = quotePosixPathArg(params.remoteOfficialPluginDir);
  const stream = await params.backend.exec(
    `if [ -d ${quotedRemoteOfficialPluginDir} ]; then command chmod -R u+rwX ${quotedRemoteOfficialPluginDir}; fi`,
  );
  try {
    await waitForClose(stream);
    return true;
  } catch (error) {
    params.loggers.logWarn(
      `[cf-agent-deploy] ${CF_AGENT_PROVIDER}: Failed to repair permissions for legacy builtin plugin directory，kContinue尝试替换 packages: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}
