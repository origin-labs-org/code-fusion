/**
 * Consistency check: registry <-> launcher HTML <-> folders.
 *
 * Fails (exit 1) when the launcher drifts from `arch/windows.json`.
 *
 * Usage: node scripts/rebrand/check-consistency.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");
const registry = JSON.parse(readFileSync(join(root, "arch", "windows.json"), "utf8"));
const html = readFileSync(join(root, "launcher", "index.html"), "utf8");
const launcherJson = JSON.parse(readFileSync(join(root, "launcher", "window.json"), "utf8"));

const checks = [];
const check = (label, ok, detail) => checks.push({ label, ok, detail });

const htmlTitle = /<title>(.*?)<\/title>/.exec(html)?.[1];
const cardNames = [...html.matchAll(/<span class="name">([^<]+)<\/span>/g)].map((m) => m[1]);
const partNames = registry.parts.map((part) => part.codename);
const ladder = registry.naming.ladder;
const resolveKeys = Object.keys(registry.aliasResolve);

check(
  "launcher window title",
  registry.launcher.windowTitle === "Launcher" && htmlTitle === "Launcher",
  `registry=${registry.launcher.windowTitle} html=${htmlTitle}`,
);
check(
  "launcher manifest matches registry",
  launcherJson.windowTitle === registry.launcher.windowTitle &&
    JSON.stringify(launcherJson.parts) === JSON.stringify(partNames),
  `window.json title=${launcherJson.windowTitle}, parts=${launcherJson.parts.length}`,
);
check("card count equals part count", cardNames.length === partNames.length, `${cardNames.length} vs ${partNames.length}`);
check("cards list the same codenames", JSON.stringify(cardNames) === JSON.stringify(partNames), cardNames.join(", "));
check(
  "alias resolve keys equal the ladder",
  JSON.stringify(ladder) === JSON.stringify(resolveKeys),
  `${ladder.join(" -> ")} | ${resolveKeys.join(" -> ")}`,
);
check(
  "every assigned alias is on the ladder",
  registry.parts.every((part) => part.alias === null || ladder.includes(part.alias)),
  registry.parts.filter((part) => part.alias && !ladder.includes(part.alias)).map((part) => part.codename).join(", ") || "none",
);
const missingFolders = registry.parts.filter((part) => !existsSync(join(root, part.folder))).map((part) => part.folder);
check("every part folder exists", missingFolders.length === 0, missingFolders.join(", ") || "none");
check(
  "every alias points at a real part",
  Object.values(registry.aliasResolve).every((codename) => partNames.includes(codename)),
  Object.entries(registry.aliasResolve).map(([alias, codename]) => `${alias}->${codename}`).join(", "),
);

let failed = 0;
for (const { label, ok, detail } of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exitCode = failed === 0 ? 0 : 1;
