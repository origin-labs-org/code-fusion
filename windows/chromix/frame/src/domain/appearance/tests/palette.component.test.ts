import "$styles/global.css";
import { afterEach, expect, test } from "vitest";
import { presets, resolveTheme, seedVars } from "../palette";
import * as theme from "../theme";

function srgb(color: string): string {
  const context = document.createElement("canvas").getContext("2d")!;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return [r, g, b].map((channel) => channel!.toString(16).padStart(2, "0")).join("");
}

function chrome(mode: "light" | "dark"): string {
  document.documentElement.dataset.theme = mode;
  const probe = document.createElement("div");
  probe.style.background = "var(--color-chrome)";
  document.body.append(probe);
  const color = srgb(getComputedStyle(probe).backgroundColor);
  probe.remove();
  return color;
}

const look = {
  custom: "",
  level: "50",
  contrast: false,
  font: "system",
  fontSize: "13",
  codeFont: "system",
};
afterEach(() => theme.applyCustomization({ ...look, theme: "zephium" }));

// Native paints the window's ground from the same seeds in Rust; the CSS
// ladder and that ground have to be one colour or a solid window seams.
test("the chrome rung matches the ground native paints for every preset", () => {
  for (const entry of presets) {
    theme.applyCustomization({ ...look, theme: entry.id });
    for (const mode of ["light", "dark"] as const) {
      const [r, g, b] = [1, 3, 5].map((at) => parseInt(entry.ground[mode].slice(at, at + 2), 16));
      const css = chrome(mode);
      const [cr, cg, cb] = [0, 2, 4].map((at) => parseInt(css.slice(at, at + 2), 16));
      expect(
        Math.max(Math.abs(r! - cr!), Math.abs(g! - cg!), Math.abs(b! - cb!)),
        `${entry.id} ${mode}`,
      ).toBeLessThanOrEqual(1);
    }
  }
});

test("graphite keeps its literal tokens and a theme derives its own", () => {
  theme.applyCustomization({ ...look, theme: "zephium" });
  expect(document.documentElement.hasAttribute("data-palette")).toBe(false);
  expect(chrome("dark")).toBe("1f1f22");
  theme.applyCustomization({ ...look, theme: "zephium", contrast: true });
  expect(document.documentElement.hasAttribute("data-palette")).toBe(true);
  theme.applyCustomization({ ...look, theme: "zephium", level: "70" });
  expect(document.documentElement.style.getPropertyValue("--seed-contrast")).toBe("70");
  theme.applyCustomization({ ...look, theme: "nord" });
  expect(document.documentElement.style.getPropertyValue("--seed-dark-bg")).toBe("#2e3440");

  // A preview scope resolves its own ladder inside a window in another theme.
  const scope = document.createElement("div");
  scope.dataset.themeScope = "";
  scope.dataset.theme = "dark";
  const dracula = resolveTheme("dracula", "").spec;
  for (const [name, value] of Object.entries(seedVars(dracula, 50)))
    scope.style.setProperty(name, value);
  document.body.append(scope);
  expect(srgb(getComputedStyle(scope).backgroundColor)).toBe(dracula.dark.bg.slice(1));
  scope.remove();
});
