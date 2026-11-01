const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

const signScriptPath = resolve(__dirname, "../../../scripts/sign-windows.ps1");

async function sign(configuration) {
  if (configuration.isNest) {
    return;
  }

  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      signScriptPath,
      "-FilePath",
      configuration.path,
    ],
    {
      stdio: "inherit",
      env: process.env,
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `[sign-windows-hook] vsigntool failed for ${configuration.path} with code ${result.status ?? "unknown"}`,
    );
  }
}

module.exports = sign;
module.exports.sign = sign;
