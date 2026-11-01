import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(
  new URL("../frame/package.json", import.meta.url),
);
const { chromium } = require("playwright");
const source = await readFile(
  new URL(
    "../crates/zephium-terra-macos-probe/src/work_app_editors.rs",
    import.meta.url,
  ),
  "utf8",
);
const editor = source.match(
  /const EDITOR: &str = r#"<script>([\s\S]*?)<\/script>"#;/,
)?.[1];
assert.ok(editor);

test("controlled loopback editor retains native paragraph and soft line breaks", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const soft of [false, true]) {
      const page = await browser.newPage();
      await page.setContent('<div id="ed" contenteditable="true"></div>');
      await page.addScriptTag({
        content: `${editor};window.editor=mount(document.getElementById('ed'),()=>{});`,
      });
      await page.locator("#ed").click();
      const text = "Hi Dana,\n\nThe release is ready.\nThanks, Hayk";
      if (soft) {
        for (const [index, line] of text.split("\n").entries()) {
          if (index) await page.keyboard.press("Shift+Enter");
          if (line) await page.keyboard.insertText(line);
        }
      } else {
        await page.keyboard.insertText(text);
      }
      assert.equal(await page.evaluate(() => window.editor.text()), text);
      await page.evaluate(() => {
        const range = document.createRange();
        range.selectNodeContents(document.getElementById("ed"));
        range.collapse(false);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      });
      await page.keyboard.press("Shift+Enter");
      assert.equal(
        await page.evaluate(() => window.editor.text()),
        `${text}\n`,
      );
      await page.evaluate(() => {
        document.getElementById("ed").textContent = "unadmitted replacement";
      });
      assert.equal(
        await page.evaluate(() => window.editor.text()),
        `${text}\n`,
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
