import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chromium } from "playwright-core";

test("PCD: newly created projects select only the active draft", { timeout: 120_000 }, async () => {
  const browser = await chromium.connectOverCDP(
    process.env.CF_E2E_CDP_URL ?? "http://localhost:9229",
  );
  const page = browser
    .contexts()[0]
    .pages()
    .find((item) => /localhost:517|file:.*index\.html/.test(item.url()));
  assert.ok(page, "需要Running的 Dev App");
  page.setDefaultTimeout(10_000);
  const artifacts =
    process.env.CF_E2E_ARTIFACT_DIR ??
    fileURLToPath(
      new URL("../../../../../desktop/.e2e-artifacts/project-created-draft/", import.meta.url),
    );
  await mkdir(artifacts, { recursive: true });
  const originalTheme = await page.locator("html").getAttribute("class");
  const evidence = [];
  const logs = [];
  page.on("console", (message) => {
    if (/ProjectCreation|创建NewTask|ProjectEditor/.test(message.text())) logs.push(message.text());
  });
  const names = [];
  const create = async (entry, name) => {
    if (entry === "sidebar") {
      await page.getByTestId("virtual-project-add").focus();
      await page.keyboard.press("Enter");
    } else {
      await page.getByTestId("composer-workspace-trigger").click();
      await page.getByTestId("composer-create-project").click();
    }
    await page.getByTestId("virtual-project-name").fill(name);
    await page.getByTestId("virtual-project-save").click();
    await page.getByTestId("virtual-project-name").waitFor({ state: "hidden" });
    await page.locator(`[data-project-name="${name}"]`).first().waitFor();
    names.push(name);
  };
  try {
    await page.getByTestId("virtual-project-new-task").focus();
    await page.keyboard.press("Enter");
    await page.locator('[data-session-id="draft"]').first().waitFor();
    for (const theme of ["light", "dark"]) {
      await page.locator("html").evaluate((element, value) => {
        element.className = `${value} theme-cf-${value}`;
      }, theme);
      for (const entry of ["sidebar", "composer"]) {
        const name = `E2E_PCD_${theme}_${entry}_${Date.now()}`;
        const input = page.getByTestId("v4-composer-input");
        const draftText = `E2E_PCD_DRAFT_${theme}_${entry}`;
        await input.fill(draftText);
        await page
          .locator('input[type="file"]')
          .last()
          .setInputFiles({
            name: `E2E_PCD_${theme}_${entry}.txt`,
            mimeType: "text/plain",
            buffer: Buffer.from("preserved attachment"),
          });
        await create(entry, name);
        await page.getByTestId("composer-workspace-trigger").filter({ hasText: name }).waitFor();
        assert.ok(await page.locator('[data-session-id="draft"]').first().isVisible());
        await page.getByTestId("v4-composer-input").filter({ hasText: draftText }).waitFor();
        await page
          .locator('[data-upload-status="ready"]')
          .filter({ hasText: `E2E_PCD_${theme}_${entry}.txt` })
          .waitFor();
        evidence.push({
          theme,
          entry,
          name,
          selected: await page.getByTestId("composer-workspace-trigger").innerText(),
        });
        await page.screenshot({ path: `${artifacts}/${theme}-${entry}.png` });
      }
    }
    const existing = page.locator("[data-task-item-key]").filter({ visible: true }).first();
    const taskKey = await existing.getAttribute("data-task-item-key");
    assert.ok(taskKey, "需要One个existing session以验证不切换");
    await existing.click();
    const sessionId = taskKey.slice(taskKey.lastIndexOf(":") + 1);
    const pane = page.locator(`[data-session-id="${sessionId}"]`).first();
    await pane.waitFor();
    await create("sidebar", `E2E_PCD_existing_${Date.now()}`);
    assert.ok(await pane.isVisible(), "创建Project不能离开existing session");
    evidence.push({ existingSessionRetained: true });
  } finally {
    await writeFile(
      `${artifacts}/evidence.json`,
      JSON.stringify({ evidence, logs, createdProjects: names }, null, 2),
    );
    await page.locator("html").evaluate((element, value) => {
      element.className = value ?? "";
    }, originalTheme);
    for (const name of names) {
      const row = page.locator(`[data-project-name="${name}"]`).first();
      await row.getByRole("button", { name: /More|More/ }).focus();
      await page.keyboard.press("Enter");
      await page.getByRole("menuitem", { name: /DeleteProject|Delete project/ }).click();
      const confirm = page.getByRole("alertdialog");
      if (await confirm.count())
        await confirm.getByRole("button", { name: /Delete|Delete|确认|Confirm/ }).click();
      await row.waitFor({ state: "hidden" });
    }
    await browser.close();
  }
});
