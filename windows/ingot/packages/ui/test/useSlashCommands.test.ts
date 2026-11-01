import { describe, expect, it, beforeEach } from "vitest";
import { selectWorkspaceCfState, useCfSessionStore } from "../src/store/cfSessionStore.js";

describe("useSlashCommands", () => {
  beforeEach(() => {
    useCfSessionStore.setState((state) => ({
      ...state,
      workspaces: {},
    }));
  });

  it("remote workspace 会按 workspaceIdentity Read slash commands", () => {
    const workspacePath = "/root";
    const workspaceIdentity = "remote:ssh:demo:22:root:/root";
    useCfSessionStore.getState().setSlashCommands(
      workspacePath,
      [{ name: "remote-command", description: "remote command" }],
      workspaceIdentity,
    );

    const identityCommands = selectWorkspaceCfState(
      useCfSessionStore.getState(),
      workspacePath,
      workspaceIdentity,
    ).slashCommands;
    const pathOnlyCommands = selectWorkspaceCfState(useCfSessionStore.getState(), workspacePath).slashCommands;

    expect(identityCommands.map((command) => command.name)).toEqual(["remote-command"]);
    expect(pathOnlyCommands).toEqual([]);
  });
});
