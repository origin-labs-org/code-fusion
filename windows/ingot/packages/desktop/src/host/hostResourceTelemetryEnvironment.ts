import { createHash } from "node:crypto";
import { buildRemoteEnvironmentKey, type RemoteTarget } from "@origin-ai/cf-shared";

export function resolveResourceTelemetryEnvironmentKey(
  target: RemoteTarget,
  serverId?: string,
): string {
  const environment = target.kind === "server" && serverId ? { ...target, serverId } : target;
  return createHash("sha256").update(buildRemoteEnvironmentKey(environment)).digest("hex");
}
