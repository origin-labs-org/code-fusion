import { validateServerInstallOwnership } from "../runtime/installationOwnership.js";
import { resolveServerLayout } from "../runtime/paths.js";

export async function resolveCoreServerId(
  serverRoot = process.env.CF_SERVER_ROOT?.trim(),
): Promise<string | undefined> {
  if (!serverRoot) return undefined;
  const ownership = await validateServerInstallOwnership(resolveServerLayout(serverRoot));
  return ownership.installationId;
}
