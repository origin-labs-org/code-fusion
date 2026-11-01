import "$styles/global.css";
import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import MarkSheet from "./MarkSheet.svelte";

test("provider marks at 16 and 20px and the app icon, both themes", async () => {
  await page.viewport(720, 260);
  const screen = await render(MarkSheet);
  // Two instances of a gradient mark never share a gradient id.
  const ids = [...screen.container.querySelectorAll("linearGradient")].map((node) => node.id);
  expect(ids.length).toBeGreaterThan(0);
  expect(new Set(ids).size).toBe(ids.length);
  for (const theme of ["dark", "light"]) {
    document.documentElement.dataset.theme = theme;
    await new Promise((done) => setTimeout(done, 300));
    await page.screenshot({ path: `../../../../../../target/look/settings/marks-${theme}.png` });
  }
});
