import { spawn } from "node:child_process";

const TEST_SHARE_ENDPOINT_ORIGIN = "https://cf.z.ai";

const mode = process.argv[2]?.trim().toLowerCase();
if (mode !== "test" && mode !== "mock") {
  console.error("Usage: node scripts/dev-web-share-env.mjs <test|mock>");
  process.exit(1);
}

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const env = {
  ...process.env,
  CF_ENV: "test",
  VITE_CF_BASE_URL: TEST_SHARE_ENDPOINT_ORIGIN,
  VITE_DEV_ORIGIN: "http://localhost:5173",
  VITE_CONVERSATION_SHARE_PREVIEW_MOCK: mode === "mock" ? "true" : "false",
};
const args = [
  "--filter",
  "@origin-ai/cf-web-share",
  "exec",
  "vite",
  "dev",
  "--strictPort",
  "--host",
  "127.0.0.1",
  //
  "--base=/",
];
if (mode === "mock") {
  args.push("--open", "/cn/share/mock-importable");
}

console.info(
  `[dev:web-share] mode=${mode} endpoint=${TEST_SHARE_ENDPOINT_ORIGIN} ` +
    "share code is read from /cn/share/<code> (zh) or /share/<code> (en)",
);

const child = spawn(pnpmCommand, args, {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

const forwardSignal = (signal) => child.kill(signal);
process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));
child.on("error", (error) => {
  console.error("[dev:web-share] failed to start Vite", error);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
