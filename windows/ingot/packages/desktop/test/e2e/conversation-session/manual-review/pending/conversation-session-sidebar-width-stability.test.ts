import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_WORKSPACE, waitForWorkspaceApp } from "../../../helpers/desktop-app.js";

const projectId = "E2E_SIDEBAR_WIDTH";
const projectSelector = `[data-project-id="${projectId}"]`;
const moreSelector = './/button[normalize-space(.)="显示更多" or normalize-space(.)="显示更多"]';

async function seedTaskRows() {
  const home = process.env.CF_E2E_HOME_DIR;
  if (!home || !basename(home).startsWith("cf-sidebar-width-"))
    throw new Error("隔离 HOME required");
  const root = join(home, "E2E_SIDEBAR_WIDTH_ROOT");
  await mkdir(root, { recursive: true });
  const db = new DatabaseSync(join(home, ".cf/v2/tasks-index.sqlite"));
  try {
    const now = Date.now();
    db.exec("BEGIN IMMEDIATE");
    db.prepare(
      "INSERT INTO projects(project_id,host_id,name,position,created_at,updated_at) VALUES(?,'local',?,-1,?,?)",
    ).run(projectId, projectId, now, now);
    db.prepare(
      "INSERT INTO project_roots(project_id,root_path,position,is_primary) VALUES(?,?,0,1)",
    ).run(projectId, root);
    const insert =
      db.prepare(`INSERT INTO tasks(workspace_key,workspace_path,task_id,title,created_at,updated_at,host_id,root_path,project_id,cli_title,cli_title_source,cli_created_at,cli_updated_at,cli_last_outcome,cli_deleted,handoff_pending)
      VALUES(?,?,?,?,?,?,'local',?,?,?,'custom',?,?,'completed',0,8)`);
    for (const group of [projectId, null]) {
      for (let index = 0; index < 25; index++) {
        const id = `E2E_WIDTH_${group ?? "TASKS"}_${index}`;
        const title =
          index % 3 === 0 ? `E2E_LONG_${"W".repeat(55)}_${index}` : `E2E_SHORT_${index}`;
        insert.run(root, root, id, title, now, now, root, group, title, now, now);
      }
    }
    db.exec("COMMIT");
  } finally {
    db.close();
  }
}

async function sampleWidths() {
  return browser.executeAsync(
    (
      done: (
        value: Array<{ grid: number; section: number; width: number; centerError: number }>,
      ) => void,
    ) => {
      const samples: Array<{ grid: number; section: number; width: number; centerError: number }> =
        [];
      const start = performance.now();
      const tick = () => {
        const grid = document.querySelector('[data-purpose-section-list="true"]')!;
        for (const button of Array.from(grid.querySelectorAll("button")).filter((node) =>
          /^(Show more|Show more)$/.test(node.textContent?.trim() ?? ""),
        )) {
          const rect = button.getBoundingClientRect();
          const parent = button.parentElement!.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(button);
          const text = range.getBoundingClientRect();
          samples.push({
            grid: grid.getBoundingClientRect().width,
            section: button
              .closest('[data-testid="project-section"], [data-testid="conversation-section"]')!
              .getBoundingClientRect().width,
            width: rect.width,
            centerError: Math.abs(text.x + text.width / 2 - parent.x - parent.width / 2),
          });
        }
        if (performance.now() - start >= 1200) done(samples);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
  );
}

describe("项目侧栏长标题宽度", () => {
  it("VP-WIDTH-01: Section/show more does not jitter when idle, centered, and pagination is normal", async function () {
    this.timeout(90_000);
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 45_000);
    await seedTaskRows();
    await browser.refresh();
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 45_000);
    const project = $(projectSelector);
    await project.waitForDisplayed();
    const tasks = $('[data-testid="conversation-section"]');
    for (const section of [project, tasks]) {
      await section.$(moreSelector).waitForExist();
      expect(await section.$$("[data-task-item-key]").length).toBe(20);
    }
    await $('[data-workspace-conversation-frame="true"]').moveTo();
    const evidence = [];
    for (const theme of ["cf-light", "cf-dark"]) {
      await browser.execute((value) => {
        const actions = (
          window as typeof window & { __testActions?: { setTheme(theme: string): void } }
        ).__testActions;
        if (!actions) throw new Error("缺少主题入口");
        actions.setTheme(value);
      }, theme);
      await browser.waitUntil(() =>
        browser.execute(
          (value) => document.documentElement.classList.contains(`theme-${value}`),
          theme,
        ),
      );
      for (const maxWidth of ["240px", "none"]) {
        await browser.execute((value) => {
          (
            document.querySelector('[data-purpose-section-list="true"]') as HTMLElement
          ).style.maxWidth = value;
        }, maxWidth);
        const samples = await sampleWidths();
        evidence.push({ theme, maxWidth, samples });
        expect(samples.length).toBeGreaterThan(10);
        expect(
          Math.max(...samples.map((sample) => sample.section - sample.grid)),
        ).toBeLessThanOrEqual(1);
        expect(Math.max(...samples.map((sample) => sample.centerError))).toBeLessThanOrEqual(1);
        const projectWidths = samples
          .filter((_, index) => index % 2 === 0)
          .map((sample) => sample.width);
        expect(Math.max(...projectWidths) - Math.min(...projectWidths)).toBeLessThanOrEqual(1);
      }
    }
    await writeFile(
      join(process.env.CF_E2E_ARTIFACT_DIR!, "sidebar-width-samples.json"),
      JSON.stringify(evidence),
    );
    for (const section of [project, tasks]) {
      const more = section.$(moreSelector);
      await more.scrollIntoView();
      await more.click();
      await browser.waitUntil(async () => (await section.$$("[data-task-item-key]").length) === 25);
      expect(await section.$(moreSelector).isExisting()).toBe(false);
    }
    await project.scrollIntoView();
    await browser.saveScreenshot(
      join(process.env.CF_E2E_ARTIFACT_DIR!, "sidebar-width-stable.png"),
    );
  });
});
