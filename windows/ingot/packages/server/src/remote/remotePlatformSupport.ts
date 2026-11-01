import type { RemoteEnvironment } from "@origin-ai/cf-server/remote/backend.js";

export function assertSupportedRemoteEnvironment(env: RemoteEnvironment): void {
  if (env.platform !== "win32") {
    return;
  }

  throw new Error("当前 remote 模式仅支持 POSIX shell 环境，暂不支持 Windows 原生远程主机");
}
