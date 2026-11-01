import { DatabaseSync } from "node:sqlite";
import { basename, join } from "node:path";
import { DEFAULT_WORKSPACE } from "../../../helpers/desktop-app.js";

import { loginWithApiKey, prepareV4ConversationE2E } from "../../../helpers/v4-conversation.js";

describe("远程单目录项目展示", () => {
  before(async function () {
    this.timeout(120_000);
    await prepareV4ConversationE2E({ skipProvider: true });
    const home = process.env.CF_E2E_HOME_DIR;
    const isolatedRunnerHome =
      home &&
      process.env.CF_E2E_REMOTE_PROFILE === "1" &&
      /^\.e2e-home-r3-[a-f0-9]{16}$/u.test(basename(home));
    if (
      !home ||
      (!basename(home).startsWith("cf-remote-project-policy-e2e-") && !isolatedRunnerHome)
    )
      throw new Error("isolated HOME required");
    const db = new DatabaseSync(join(home, ".cf/v2/tasks-index.sqlite"));
    try {
      db.exec("BEGIN IMMEDIATE");
      db.prepare(
        "INSERT INTO projects(project_id,host_id,name,position,created_at,updated_at) VALUES('e2e-vpr-local','local','E2E_VPR_LOCAL',0,1,1)",
      ).run();
      db.prepare(
        "INSERT INTO project_roots(project_id,root_path,position,is_primary) VALUES('e2e-vpr-local',?,0,1),('e2e-vpr-local',?,1,0)",
      ).run(DEFAULT_WORKSPACE, join(DEFAULT_WORKSPACE, "extra"));
      for (const device of ["a", "b"]) {
        const host = `remote:server:e2e-vpr-${device}`;
        db.prepare(
          "INSERT INTO hosts(host_id,kind,membership_id,position,target_json) VALUES(?,'server',?,?,?)",
        ).run(
          host,
          `member-${device}`,
          device === "a" ? 1 : 2,
          JSON.stringify({
            kind: "server",
            name: `Device ${device}`,
            url: `http://127.0.0.1:1/${device}`,
          }),
        );
        db.prepare(
          "INSERT INTO remote_project_entries(entry_id,host_id,remote_project_id,cached_name,cached_roots_json,last_synced_at) VALUES(?,?,?,?,?,1)",
        ).run(
          `entry-${device}`,
          host,
          `e2e-vpr-${device}`,
          `E2E_VPR_${device.toUpperCase()}`,
          JSON.stringify([{ rootPath: "/same", isPrimary: true, position: 0 }]),
        );
      }
      db.exec("COMMIT");
    } finally {
      db.close();
    }
    await refreshSidebar();
    try {
      await $('[data-project-id="e2e-vpr-b"]').waitForDisplayed({ timeout: 15_000 });
    } catch (error) {
      console.error("VPR DOM", await browser.execute(() => document.body.innerText));
      await browser.saveScreenshot(join(home, "session-vpr-failure.png"));
      throw error;
    }
  });

  it("VPR01: Cross-device offline sorting, refresh, and removal entries; no Host grouping in sidebar", async () => {
    expect(await $('[data-testid="remote-project-host"]').isExisting()).toBe(false);
    expect(await $$('[data-testid="project-device"]')).toHaveLength(2);
    const order = () =>
      browser.execute(() =>
        [...document.querySelectorAll('[data-testid="project-section"] [data-project-id]')].map(
          (row) => row.getAttribute("data-project-id"),
        ),
      );
    const before = await order();
    const coords = await browser.execute(() => {
      const rect = (id: string) =>
        document
          .querySelector(`[data-project-id="${id}"] [data-testid="virtual-project-toggle"]`)!
          .getBoundingClientRect();
      const a = rect("e2e-vpr-a"),
        b = rect("e2e-vpr-b");
      return {
        x: Math.round(b.x + 40),
        from: Math.round(b.y + b.height / 2),
        to: Math.round(a.y + a.height / 2),
      };
    });
    await browser.performActions([
      {
        type: "pointer",
        id: "project-mouse",
        parameters: { pointerType: "mouse" },
        actions: [
          { type: "pointerMove", duration: 0, x: coords.x, y: coords.from },
          { type: "pointerDown", button: 0 },
          { type: "pointerMove", duration: 100, x: coords.x, y: coords.from - 8 },
          { type: "pointerMove", duration: 200, x: coords.x, y: coords.to },
          { type: "pointerUp", button: 0 },
        ],
      },
    ]);
    await browser.releaseActions();
    await browser.waitUntil(async () => JSON.stringify(await order()) !== JSON.stringify(before));
    const sorted = await order();
    expect(sorted.indexOf("e2e-vpr-b")).toBeLessThan(sorted.indexOf("e2e-vpr-a"));
    await refreshSidebar();
    await $('[data-project-id="e2e-vpr-b"]').waitForDisplayed({ timeout: 45_000 });
    expect(await order()).toEqual(sorted);
    const row = $('[data-project-id="e2e-vpr-b"]');
    expect(await row.$('[data-testid="virtual-project-create-task"]').isExisting()).toBe(false);
    await row.moveTo();
    await row.$('[data-testid="virtual-project-menu"]').click();
    await $('[data-testid="virtual-project-remove-entry"]').click();
    await row.waitForExist({ reverse: true });
    const prefs = await browser.execute(
      () =>
        JSON.parse(localStorage.getItem("cf-project-sidebar-preferences") ?? "{}")
          .order as string[],
    );
    expect(prefs.some((key) => key.includes("e2e-vpr-b"))).toBe(false);
    expect(await $('[data-project-id="e2e-vpr-a"]').isDisplayed()).toBe(true);
  });
});

async function refreshSidebar() {
  await browser.refresh();
  const login = $('[data-testid="login-use-api-key-button"]');
  const project = $('[data-project-id="e2e-vpr-b"]');
  await browser.waitUntil(
    async () => (await login.isDisplayed()) || (await project.isDisplayed()),
    { timeout: 45_000 },
  );
  if (await login.isDisplayed()) await loginWithApiKey();
  await project.waitForDisplayed({ timeout: 45_000 });
}
