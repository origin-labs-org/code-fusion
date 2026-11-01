import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createPlugin } from "../skills/plugin-creator/scripts/create-basic-plugin.mjs";
import { upsertDevMarketplace } from "../skills/plugin-creator/scripts/upsert-dev-marketplace.mjs";

if (!process.argv[2])
  throw new Error("Usage: node dev-workflow.integration.mjs <built-cf-cli-js>");
const cli = resolve(process.argv[2]);
const root = await mkdtemp(join(tmpdir(), "cf-dev-workflow-"));
const execute = promisify(execFile);
const env = { ...process.env, CF_STORAGE_DIR: join(root, "storage") };
async function command(...args) {
  const { stdout } = await execute(process.execPath, [cli, "plugins", ...args, "--json"], {
    cwd: root,
    env,
  });
  return JSON.parse(stdout);
}
try {
  const source = await createPlugin({
    name: "dev-demo",
    parentPath: join(root, "plugins"),
    components: ["skills"],
  });
  const skillPath = join("skills", "dev-demo", "SKILL.md");
  await writeFile(
    join(source, skillPath),
    "---\nname: dev-demo\ndescription: Show the development workflow marker\n---\nReturn DEV_WORKFLOW_ONE.\n",
  );
  const dev = await upsertDevMarketplace({
    pluginPath: source,
    displayName: "Development Demo",
    nameZh: "开发演示",
    descriptionZh: "开发闭环测试",
  });
  await command("validate", source);
  await command("validate", dev.marketplacePath);
  const added = await command("marketplace", "add", dev.marketplaceRoot);
  assert.equal(added.id, dev.marketplaceId);
  const markets = await command("marketplace", "list");
  const registered = markets.find((m) => m.id === dev.marketplaceId);
  assert.equal(registered.source.source, "directory");
  assert.equal(await realpath(registered.source.path), dev.marketplaceRoot);
  assert.equal(
    (await command("list", "--available")).available.find((p) => p.id === dev.pluginId)?.version,
    "0.1.0",
  );
  assert.equal((await command("install", dev.pluginId)).ok, true);
  let installed = (await command("list")).find((p) => p.id === dev.pluginId);
  assert.equal(installed.enabled, true);
  assert.equal(installed.skillCount, 1);
  assert.notEqual(await realpath(installed.rootPath), await realpath(source));
  assert.match(await readFile(join(installed.rootPath, skillPath), "utf8"), /DEV_WORKFLOW_ONE/);

  const manifestPath = join(source, ".cf-plugin", "plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.version = "0.1.1";
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(
    join(source, skillPath),
    "---\nname: dev-demo\ndescription: Show the updated development workflow marker\n---\nReturn DEV_WORKFLOW_TWO.\n",
  );
  assert.match(await readFile(join(installed.rootPath, skillPath), "utf8"), /DEV_WORKFLOW_ONE/);
  await command("disable", dev.pluginId);
  assert.equal((await upsertDevMarketplace({ pluginPath: source })).pluginId, dev.pluginId);
  assert.equal((await command("marketplace", "update", dev.marketplaceId)).ok, true);
  assert.equal((await command("update", dev.pluginId)).ok, true);
  installed = (await command("list")).find((p) => p.id === dev.pluginId);
  assert.equal(installed.version, "0.1.1");
  assert.equal(installed.enabled, false);
  assert.match(await readFile(join(installed.rootPath, skillPath), "utf8"), /DEV_WORKFLOW_TWO/);
  await command("validate", installed.rootPath);
  const { preflightPlugin } = await import("../skills/plugin-creator/scripts/validate-plugin.mjs");
  assert.deepEqual(await preflightPlugin(installed.rootPath), []);
  console.log(
    JSON.stringify({
      result: "passed",
      marketplace: dev.marketplaceId,
      created: "0.1.0",
      updated: installed.version,
      preservesDisabled: true,
      sourceAndInstallSeparated: true,
    }),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
