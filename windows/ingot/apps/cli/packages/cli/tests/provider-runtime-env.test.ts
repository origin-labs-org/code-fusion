import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import {
  CF_BUILTIN_PROVIDER_CONFIG_FILE_ENV,
  CF_PERSONAL_PROVIDER_CONFIG_FILE_ENV,
} from "@origin-ai/cf-provider-node";
import {
  SEA_CF_BUILTIN_PROVIDER_CONFIG_ASSET_KEY,
  prepareCliProviderRuntimeEnv,
} from "../src/provider-runtime-env.js";

const temporaryDirectories: string[] = [];

test.afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

test("preserves explicitly injected provider runtime paths", async () => {
  const prepared = await prepareCliProviderRuntimeEnv({
    argv: ["--prompt", "hello"],
    env: {
      [CF_BUILTIN_PROVIDER_CONFIG_FILE_ENV]: "/injected/cf-builtin.json",
      [CF_PERSONAL_PROVIDER_CONFIG_FILE_ENV]: "/injected/personal.json",
    },
  });

  assert.deepEqual(prepared, {
    [CF_BUILTIN_PROVIDER_CONFIG_FILE_ENV]: "/injected/cf-builtin.json",
    [CF_PERSONAL_PROVIDER_CONFIG_FILE_ENV]: "/injected/personal.json",
  });
});

test("resolves the development CodeFusion Built-in Config and shared Personal Config", async () => {
  const root = await temporaryDirectory();
  const entrypoint = join(root, "apps/cli/packages/cli/src/main.ts");
  const cfBuiltinFilePath = join(root, "config/provider/cf-builtin.json");
  await mkdir(dirname(entrypoint), { recursive: true });
  await mkdir(dirname(cfBuiltinFilePath), { recursive: true });
  await writeFile(entrypoint, "");
  await writeFile(cfBuiltinFilePath, EMPTY_RELEASE);

  const prepared = await prepareCliProviderRuntimeEnv({
    argv: ["tui"],
    dataBaseDir: join(root, "home"),
    entrypoint,
    env: {},
    appVersion: "test-version",
    platform: "test-platform",
  });

  assertActiveConfigPath(prepared[CF_BUILTIN_PROVIDER_CONFIG_FILE_ENV], join(root, "home"));
  assert.equal(
    prepared[CF_PERSONAL_PROVIDER_CONFIG_FILE_ENV],
    join(root, "home/.cf/v2/provider_config.json"),
  );
  const activeFilePath = prepared[CF_BUILTIN_PROVIDER_CONFIG_FILE_ENV];

  const loginPrepared = await prepareCliProviderRuntimeEnv({
    argv: ["login"],
    dataBaseDir: join(root, "home"),
    entrypoint,
    env: {},
    appVersion: "test-version",
    platform: "test-platform",
  });
  assert.equal(loginPrepared[CF_BUILTIN_PROVIDER_CONFIG_FILE_ENV], activeFilePath);
  const logoutPrepared = await prepareCliProviderRuntimeEnv({
    argv: ["logout"],
    dataBaseDir: join(root, "home"),
    entrypoint,
    env: {},
    appVersion: "test-version",
    platform: "test-platform",
  });
  assert.equal(logoutPrepared[CF_BUILTIN_PROVIDER_CONFIG_FILE_ENV], activeFilePath);
  assert.equal(
    prepared.CF_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE,
    await realpath(cfBuiltinFilePath),
  );
  await assert.rejects(access(join(dirname(activeFilePath!), "cf-builtin-refresh.json")));
});

test("materializes the SEA config in the fixed environment resource path, separate from downloads", async () => {
  const root = await temporaryDirectory();
  const cfBuiltinContent = EMPTY_RELEASE;
  let reads = 0;
  const prepared = await prepareCliProviderRuntimeEnv({
    argv: ["--prompt", "hello"],
    dataBaseDir: root,
    env: {},
    sea: {
      getAsset(key, encoding) {
        assert.equal(key, SEA_CF_BUILTIN_PROVIDER_CONFIG_ASSET_KEY);
        assert.equal(encoding, "utf8");
        reads += 1;
        return cfBuiltinContent;
      },
      isSea: () => true,
    },
    appVersion: "test-version",
    platform: "test-platform",
  });

  const cfBuiltinFilePath = prepared[CF_BUILTIN_PROVIDER_CONFIG_FILE_ENV];
  assert.ok(cfBuiltinFilePath);
  assertActiveConfigPath(cfBuiltinFilePath, root);
  assert.deepEqual(
    JSON.parse(await readFile(cfBuiltinFilePath, "utf8")),
    JSON.parse(cfBuiltinContent),
  );
  assert.equal(reads, 1);
  const resource = join(
    root,
    ".cf",
    "v2",
    "runtime",
    "provider",
    "bundled",
    "cf-builtin.json",
  );
  assert.notEqual(resource, cfBuiltinFilePath);
  assert.deepEqual(JSON.parse(await readFile(resource, "utf8")), JSON.parse(cfBuiltinContent));
  assert.equal(prepared.CF_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE, resource);
  await assert.rejects(access(join(dirname(cfBuiltinFilePath), "cf-builtin-refresh.json")));
});

test("does not resolve provider assets for commands that do not run Core", async () => {
  assert.deepEqual(
    await prepareCliProviderRuntimeEnv({
      argv: ["doctor", "--json"],
      env: {},
    }),
    {},
  );
  for (const flag of ["--help", "-h", "--version", "-v"]) {
    assert.deepEqual(
      await prepareCliProviderRuntimeEnv({
        argv: [flag],
        env: {},
      }),
      {},
    );
  }
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "cf-cli-provider-runtime-"));
  temporaryDirectories.push(directory);
  return directory;
}

function assertActiveConfigPath(filePath: string | undefined, dataBaseDir: string): void {
  assert.ok(filePath);
  assert.equal(
    dirname(dirname(filePath)),
    join(dataBaseDir, ".cf", "v2", "runtime", "provider", "test-platform", "test-version"),
  );
  assert.match(basename(dirname(filePath)), /^endpoint-[a-f0-9]{32}$/u);
  assert.equal(basename(filePath), "cf-builtin.json");
}

const EMPTY_RELEASE =
  '{"schemaVersion":1,"revision":1,"config":{"providerConfigRules":{"templateRules":[],"providerRules":[]},"modelConfigRules":{"modelRules":[],"modelApiRules":[],"providerSiteRules":[],"templateModelRules":[],"builtinProviderModelRules":[]}}}';
