import type { RemoteTarget } from "@origin-ai/cf-shared";
import type { SourceServerDirectory } from "./sourceServerDirectory.js";
import {
  type ConnectSourceServerOptions,
  type SourceServerConnectionManager,
} from "./sourceServerConnectionManager.js";

export async function connectSourceServerTarget(
  directory: Pick<SourceServerDirectory, "ensureProfile">,
  manager: Pick<SourceServerConnectionManager, "connect">,
  options: Omit<ConnectSourceServerOptions, "profile" | "target"> & {
    target: Exclude<RemoteTarget, { kind: "server" }>;
  },
) {
  const profile = await directory.ensureProfile(options.target, { deferCredentials: true });
  const connection = await manager.connect({
    ...options,
    profile,
    onAuthenticatedUpgradeRequired: async () => {
      options.context?.signal?.throwIfAborted();
      await directory.ensureProfile(options.target);
    },
  });
  options.context?.signal?.throwIfAborted();
  const committedProfile = connection.reusedConnectionTarget
    ? profile
    : await directory.ensureProfile(options.target);
  return { profile: committedProfile, connection };
}
