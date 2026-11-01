import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startDraftFromProject } from "#e2e/helpers/project-sidebar";
import {
  disconnectRemoteSource,
  reconnectRemoteProject,
} from "./e2e/helpers/remote-project-actions.js";

vi.mock("./e2e/helpers/desktop-app.js", () => ({
  clickTestIdByDom: vi.fn(),
  waitForTestIdByDom: vi.fn(),
  readSettings: async () => ({
    sourceServers: [{ sourceServerId: "source-b", displayName: "device-b" }],
  }),
}));
vi.mock("./e2e/helpers/ssh-remote-p0.js", () => ({
  readRemoteTabSnapshot: async () => ({ workspacePath: "/work" }),
  waitForRemoteTab: vi.fn(),
  waitForSSHDirectoryStep: vi.fn(),
}));
vi.mock("./e2e/helpers/workspace-agent-warmup.js", () => ({ selectTaskOrganizeMode: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

function install(document: object) {
  vi.stubGlobal("browser", {
    execute: async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
      runInNewContext(`(${fn.toString()})(...args)`, { document, args }),
    waitUntil: async (predicate: () => Promise<boolean>) => {
      if (!(await predicate())) throw new Error("入口不可用");
    },
  });
}

describe("项目导航 E2E 动作归属", () => {
  it("Disconnect waits for the specified project to go offline; cannot treat other offline projects or old setting projections as completion", async () => {
    const identity = "remote:server:source-b:/work";
    const project = { dataset: { connectionState: "online" } };
    const disconnect = {
      innerText: "断开",
      disabled: false,
      getClientRects: () => [1],
      click: vi.fn(),
    };
    const card = { querySelectorAll: () => [disconnect] };
    install({
      querySelector: (selector: string) => {
        if (selector === '[data-testid="settings-page"]')
          return { querySelectorAll: () => [{ textContent: "device-b", closest: () => card }] };
        if (selector === `[data-project-workspace-identity=${JSON.stringify(identity)}]`)
          return project;
        return { dataset: { connectionState: "offline" } };
      },
    });
    await expect(
      disconnectRemoteSource("source-b", "E2E_SCOPE", { workspaceIdentities: [identity] }),
    ).rejects.toThrow("目标项目未离线");
    project.dataset.connectionState = "offline";
    await expect(
      disconnectRemoteSource("source-b", "E2E_SCOPE", { workspaceIdentities: [identity] }),
    ).resolves.toBeUndefined();
  });

  it("New drafts in the same directory only click projects of the specified Source, without using the global task entry", async () => {
    const clicks = [vi.fn(), vi.fn()];
    const identities = ["remote:server:a:/work", "remote:server:b:/work"];
    vi.stubGlobal("$", (selector: string) => {
      const index = identities.findIndex(
        (identity) => selector === `[data-project-workspace-identity=${JSON.stringify(identity)}]`,
      );
      if (index < 0) throw new Error(`未按 Source identity 定位Project：${selector}`);
      return {
        waitForDisplayed: vi.fn(),
        moveTo: vi.fn(),
        $: (action: string) => {
          expect(action).toBe('[data-testid="virtual-project-create-task"]');
          return { click: clicks[index] };
        },
      };
    });
    vi.stubGlobal("browser", {
      execute: async () => true,
      waitUntil: async (predicate: () => Promise<boolean>) => {
        expect(await predicate()).toBe(true);
      },
    });
    await startDraftFromProject("/work", { workspaceIdentity: identities[1] });
    expect(clicks[0]).not.toHaveBeenCalled();
    expect(clicks[1]).toHaveBeenCalledOnce();
  });

  it("Disconnect the matching device without accidentally clicking other Sources that appear first", async () => {
    const clicks = [vi.fn(), vi.fn()];
    const cards = ["device-a", "device-b"].map((name, i) => ({
      querySelectorAll: (selector: string) =>
        selector === "p"
          ? [{ textContent: name }]
          : [{ getClientRects: () => [1], innerText: "断开", click: clicks[i] }],
    }));
    const paragraphs = cards.map((card, i) => ({
      textContent: `device-${i === 0 ? "a" : "b"}`,
      closest: () => card,
    }));
    const outer = { querySelectorAll: () => paragraphs };
    install({
      querySelector: () => ({
        querySelectorAll: (selector: string) => (selector === "p" ? paragraphs : [outer, ...cards]),
      }),
    });
    await disconnectRemoteSource("source-b", "E2E_SCOPE");
    expect(clicks[0]).not.toHaveBeenCalled();
    expect(clicks[1]).toHaveBeenCalledOnce();
  });

  it("Projects with the same path from different Sources only reconnect the specified identity", async () => {
    const clicks = [vi.fn(), vi.fn()];
    let selected = -1;
    vi.stubGlobal("$", (selector: string) => {
      if (selector === '[data-testid="virtual-project-connect"]')
        return { click: () => clicks[selected]() };
      const keys = ["remote:server:a:/work", "remote:server:b:/work"];
      const index = keys.findIndex(
        (key) => selector === `[data-project-workspace-identity=${JSON.stringify(key)}]`,
      );
      if (index < 0) throw new Error(`UnknownProject：${selector}`);
      return {
        waitForDisplayed: vi.fn(),
        moveTo: vi.fn(),
        $: (menu: string) => {
          expect(menu).toBe('[data-testid="virtual-project-menu"]');
          return {
            click: () => {
              selected = index;
            },
          };
        },
      };
    });
    await reconnectRemoteProject("remote:server:b:/work", "E2E_SCOPE");
    expect(clicks[0]).not.toHaveBeenCalled();
    expect(clicks[1]).toHaveBeenCalledOnce();
  });
});
