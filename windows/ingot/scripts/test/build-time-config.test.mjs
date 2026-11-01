import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { createBuildTimeConfigDefines, resolveBuildTimeConfig } from "../build-time-config.mjs";

const dir = await mkdtemp(join(tmpdir(), "cf-build-time-config-"));
after(() => rm(dir, { recursive: true, force: true }));

async function writeDefaults(name, content) {
  const path = join(dir, name);
  await writeFile(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

test("没有私有DefaultConfiguration也没有环Context变量时Three项Capabilities都Close", async () => {
  const config = await resolveBuildTimeConfig({}, { defaultsPath: join(dir, "missing.json") });
  assert.deepEqual(config, {
    armsRumEndpoint: "",
    telemetryReportEndpoint: "",
    autoUpdateEnabled: false,
  });
});

test("私有DefaultConfigurationEnableThree项Capabilities", async () => {
  const defaultsPath = await writeDefaults("defaults.json", {
    CF_ARMS_RUM_ENDPOINT: " https://rum.example.com/x ",
    CF_TELEMETRY_REPORT_ENDPOINT: "https://report.example.com/event",
    CF_AUTO_UPDATE: "1",
  });
  assert.deepEqual(await resolveBuildTimeConfig({}, { defaultsPath }), {
    armsRumEndpoint: "https://rum.example.com/x",
    telemetryReportEndpoint: "https://report.example.com/event",
    autoUpdateEnabled: true,
  });
});

test("环Context变量优先于私有DefaultConfiguration，显式Empty stringClose单项Capabilities", async () => {
  const defaultsPath = await writeDefaults("override.json", {
    CF_ARMS_RUM_ENDPOINT: "https://rum.example.com/x",
    CF_TELEMETRY_REPORT_ENDPOINT: "https://report.example.com/event",
    CF_AUTO_UPDATE: "true",
  });
  const config = await resolveBuildTimeConfig(
    {
      CF_ARMS_RUM_ENDPOINT: "",
      CF_TELEMETRY_REPORT_ENDPOINT: "https://other.example.com/event",
      CF_AUTO_UPDATE: "0",
    },
    { defaultsPath },
  );
  assert.deepEqual(config, {
    armsRumEndpoint: "",
    telemetryReportEndpoint: "https://other.example.com/event",
    autoUpdateEnabled: false,
  });
});

test("私有DefaultConfiguration格式Error时直接报Wrong，不静默Close", async () => {
  const defaultsPath = await writeDefaults("broken.json", "[1]");
  await assert.rejects(resolveBuildTimeConfig({}, { defaultsPath }), /必须Yes JSON 对e/);
});

test("define 以 JSON Character面量注入", () => {
  assert.deepEqual(
    createBuildTimeConfigDefines({
      armsRumEndpoint: "https://rum.example.com/x",
      telemetryReportEndpoint: "",
      autoUpdateEnabled: true,
    }),
    {
      __CF_ARMS_RUM_ENDPOINT__: '"https://rum.example.com/x"',
      __CF_TELEMETRY_REPORT_ENDPOINT__: '""',
      __CF_AUTO_UPDATE_ENABLED__: "true",
    },
  );
});
