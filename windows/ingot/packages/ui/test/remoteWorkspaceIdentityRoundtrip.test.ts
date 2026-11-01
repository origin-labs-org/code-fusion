import { describe, expect, it } from "vitest";
import { parseRemoteWorkspaceIdentity } from "@origin-ai/cf-shared";
import { buildRemoteWorkspaceIdentity } from "@/lib/remoteWorkspaceHistory.js";

describe("Remote workspace identity build↔parse duality", () => {
  it("ssh：build → parse 还原 workspacePath", () => {
    const identity = buildRemoteWorkspaceIdentity("/srv/app/", {
      kind: "ssh",
      host: "Dev.Example.com",
      port: 2222,
      username: "root",
    });
    expect(parseRemoteWorkspaceIdentity(identity)).toEqual({
      kind: "ssh",
      workspacePath: "/srv/app",
    });
  });

  it("ssh default port (22) and wsl/docker: build → parse restores correctly", () => {
    const sshDefault = buildRemoteWorkspaceIdentity("/home/dev", {
      kind: "ssh",
      host: "h",
      username: "u",
    });
    expect(parseRemoteWorkspaceIdentity(sshDefault)?.workspacePath).toBe(
      "/home/dev",
    );

    const wsl = buildRemoteWorkspaceIdentity("/mnt/c/ws", {
      kind: "wsl",
      distro: "Ubuntu-22.04",
    });
    expect(parseRemoteWorkspaceIdentity(wsl)).toEqual({
      kind: "wsl",
      workspacePath: "/mnt/c/ws",
    });

    const docker = buildRemoteWorkspaceIdentity("/workspace", {
      kind: "docker",
      container: "my-container",
    });
    expect(parseRemoteWorkspaceIdentity(docker)).toEqual({
      kind: "docker",
      workspacePath: "/workspace",
    });
  });

  it("wsl 显式 user：build → parse 不把 user 混入 workspacePath", () => {
    const identity = buildRemoteWorkspaceIdentity("/home/dev/ws", {
      kind: "wsl",
      distro: "Ubuntu-24.04",
      user: "dev",
    });

    expect(identity).toBe("remote:wsl:Ubuntu-24.04:dev:/home/dev/ws");
    expect(parseRemoteWorkspaceIdentity(identity)).toEqual({
      kind: "wsl",
      workspacePath: "/home/dev/ws",
    });
  });

  it("Backslash paths are normalized to POSIX during construction and can be restored upon parsing", () => {
    const identity = buildRemoteWorkspaceIdentity("\\srv\\app", {
      kind: "docker",
      container: "c1",
    });
    expect(parseRemoteWorkspaceIdentity(identity)?.workspacePath).toBe(
      "/srv/app",
    );
  });
});
