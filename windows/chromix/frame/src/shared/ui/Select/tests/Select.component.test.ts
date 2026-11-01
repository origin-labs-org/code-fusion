import "$styles/global.css";
import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import Select from "../Select.svelte";

const options = ["Small", "Medium", "Large", "Extra large"].map((label) => ({
  value: label.toLowerCase(),
  label,
}));

test("the chosen row opens over the trigger, its label on the trigger's", async () => {
  await page.viewport(640, 480);
  document.body.style.padding = "200px 160px";
  const screen = await render(Select, { label: "Size", options, value: "large" });
  const trigger = screen.getByRole("button", { name: "Size" }).element() as HTMLElement;
  await screen.getByRole("button", { name: "Size" }).click();
  const row = page.getByRole("option", { name: "Large", exact: true });
  await expect.element(row).toBeVisible();
  await new Promise((done) => setTimeout(done, 400));
  const at = trigger.getBoundingClientRect();
  const on = (row.element() as HTMLElement).getBoundingClientRect();
  expect(Math.abs(on.top + on.height / 2 - (at.top + at.height / 2))).toBeLessThan(2);
  await page.screenshot({ path: "../../../../../../target/look/select/popup.png" });
});
