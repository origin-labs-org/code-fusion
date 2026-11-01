import { CF_AGENT_PROVIDER_NOT_READY_CODE } from "@origin-ai/cf-shared";

type RpcLogLevel = "debug" | "info" | "warn";

export function resolveRpcLogLevel(message: string, ...args: unknown[]): RpcLogLevel {
  if (message.startsWith("[rpc:call] cf-agent.backgroundBashOutputV4 OK (")) return "debug";

  if (
    message.includes("cf-session.getWorkspaceRuntimeIdentity FAIL") &&
    args.some(
      (arg) =>
        typeof arg === "object" &&
        arg !== null &&
        "code" in arg &&
        (arg as { code?: unknown }).code === CF_AGENT_PROVIDER_NOT_READY_CODE,
    )
  ) {
    return "info";
  }

  return message.includes(" FAIL ") ? "warn" : "info";
}
