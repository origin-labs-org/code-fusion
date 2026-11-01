import { describe, expect, it, vi } from "vitest";
import type { RemoteTarget } from "@origin-ai/cf-shared";
import { pushDynamicWorkflowUserModeToRemoteHosts } from "../src/host/remoteDynamicWorkflowUserMode.js";

function agent() {
  return { syncDynamicWorkflowUserMode: vi.fn(async (_params: { mode?: string }) => undefined) };
}

describe("pushDynamicWorkflowUserModeToRemoteHosts（DWG-21）", () => {
  it("推给 SSH/WSL/Docker 连接，跳过 standalone server", async () => {
    const ssh = agent();
    const docker = agent();
    const server = agent();
    const targets: Array<{ target: RemoteTarget; cfAgentService: ReturnType<typeof agent> }> = [
      { target: { kind: "ssh", host: "h", username: "u" }, cfAgentService: ssh },
      { target: { kind: "docker", container: "c" }, cfAgentService: docker },
      { target: { kind: "server", url: "https://s.example.com" }, cfAgentService: server },
    ];
    await pushDynamicWorkflowUserModeToRemoteHosts(targets, "onDemand", vi.fn());
    expect(ssh.syncDynamicWorkflowUserMode).toHaveBeenCalledWith({ mode: "onDemand" });
    expect(docker.syncDynamicWorkflowUserMode).toHaveBeenCalledWith({ mode: "onDemand" });
    expect(server.syncDynamicWorkflowUserMode).not.toHaveBeenCalled();
  });

  it("跟随服务端时推不带 mode 的信号", async () => {
    const ssh = agent();
    await pushDynamicWorkflowUserModeToRemoteHosts(
      [{ target: { kind: "ssh", host: "h", username: "u" }, cfAgentService: ssh }],
      undefined,
      vi.fn(),
    );
    expect(ssh.syncDynamicWorkflowUserMode).toHaveBeenCalledWith({});
  });

  it("A single remote Host failure (older version does not recognize method, disconnected) only reports an error, affecting no other connections and not throwing", async () => {
    const broken = {
      syncDynamicWorkflowUserMode: vi.fn(async () => {
        throw new Error("Unknown command");
      }),
    };
    const ok = agent();
    const onError = vi.fn();
    await expect(
      pushDynamicWorkflowUserModeToRemoteHosts(
        [
          { target: { kind: "wsl", distro: "Ubuntu" }, cfAgentService: broken },
          { target: { kind: "ssh", host: "h", username: "u" }, cfAgentService: ok },
        ],
        "disabled",
        onError,
      ),
    ).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(ok.syncDynamicWorkflowUserMode).toHaveBeenCalledWith({ mode: "disabled" });
  });
});
