import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TID_V4_COMPOSER_INPUT } from "@origin-ai/cf-shared/test-ids";
import {
  getE2EAppDataPaths,
  setInputValueByTestIdDom,
  switchToNewestWindow,
  waitForDefaultWorkspaceReady,
} from "../../../helpers/desktop-app.js";

const marker = "E2E_MFH01_HOST_SEARCH";
const relativePath = `.cf-e2e/file-mention-host-search/${marker}.ts`;
const root = join(getE2EAppDataPaths().workspace, ".cf-e2e", "file-mention-host-search");

describe("MFH01：@ 文件候选由 Host 查询", () => {
  before(async () => {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, `${marker}.ts`), "export const marker = true;\n");
    await browser.waitUntil(
      async () => {
        await switchToNewestWindow();
        return (
          (await $('[data-testid="onboarding-page"]').isDisplayed()) ||
          (await $(`[data-testid="${TID_V4_COMPOSER_INPUT}"]`).isDisplayed())
        );
      },
      { timeout: 30000, timeoutMsg: "Initial onboarding or Composer did not appear" },
    );
    if (await $('[data-testid="onboarding-page"]').isDisplayed()) {
      await browser.keys("Escape");
    }
    await waitForDefaultWorkspaceReady(30000);
  });
  after(async () => {
    await rm(root, { recursive: true, force: true });
    await browser.electron.restoreAllMocks();
  });
  it("Keyword finds actual file and inserts mention; input continues to respond", async () => {
    await setInputValueByTestIdDom(TID_V4_COMPOSER_INPUT, `@${marker}`, {
      stabilizeLexicalCaretAtEnd: true,
    });
    const option = await $(`[data-option-id="file:${relativePath}"]`);
    await option.waitForDisplayed({ timeout: 30000 });
    await option.click();
    const input = await $(`[data-testid="${TID_V4_COMPOSER_INPUT}"]`);
    await expect(input).toHaveText(expect.stringContaining(`${marker}.ts`));
    await input.click();
    await browser.keys("继续输入");
    await expect(input).toHaveText(expect.stringContaining("继续输入"));
  });
});
