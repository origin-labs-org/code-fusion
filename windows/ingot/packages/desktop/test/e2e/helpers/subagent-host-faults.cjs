const fs = require("node:fs");
const fsp = require("node:fs/promises");
const { join } = require("node:path");
const { syncBuiltinESMExports } = require("node:module");
const root = process.env.CF_E2E_HOST_FAULT_ROOT;
const controlPath = join(root, "host-fault-control.json");
const logPath = join(root, `host-boundary-${process.pid}.jsonl`);
const control = () => JSON.parse(fs.readFileSync(controlPath, "utf8"));
const log = (event) =>
  fs.appendFileSync(logPath, JSON.stringify({ pid: process.pid, ...event }) + "\n");
const consumed = new Set();
const readCounts = new Map();
function released(id) {
  return control().released?.includes(id);
}
function waitForRelease(id) {
  return new Promise((resolve) => {
    const watcher = fs.watch(root, () => {
      if (released(id)) {
        watcher.close();
        resolve();
      }
    });
    if (released(id)) {
      watcher.close();
      resolve();
    }
  });
}
for (const operation of ["readFile", "readdir", "writeFile"]) {
  const original = fsp[operation];
  fsp[operation] = async function (path, ...args) {
    if (control().tracePaths?.includes(String(path))) {
      if (operation === "readFile")
        readCounts.set(String(path), (readCounts.get(String(path)) ?? 0) + 1);
      log({
        kind: "file-called",
        operation,
        path: String(path),
        paths: [String(path)],
        stack: new Error().stack,
      });
    }
    const watcherScan = operation === "readdir" && /ReaddirpStream/.test(new Error().stack ?? "");
    const rule = control().files?.find(
      (r) =>
        !watcherScan &&
        r.operation === operation &&
        String(path) === r.path &&
        (!r.once || !consumed.has(r.id)),
    );
    if (!rule) return original.call(this, path, ...args);
    consumed.add(rule.id);
    if (rule.action === "fail") {
      log({ kind: "file-failed", id: rule.id, operation, path: String(path) });
      throw Object.assign(new Error(`E2E ${operation} failed`), { code: "EACCES" });
    }
    const result = await original.call(this, path, ...args);
    log({ kind: "file-held", id: rule.id, operation, path: String(path) });
    await waitForRelease(rule.id);
    log({ kind: "file-released", id: rule.id });
    if (rule.rejectAfterRelease) throw new Error("E2E stale read rejected");
    return result;
  };
}
syncBuiltinESMExports();
const post = process.parentPort.postMessage.bind(process.parentPort);
process.parentPort.postMessage = (...args) => {
  const [frame] = args;
  if (
    frame?.source === "host" &&
    typeof frame.message === "string" &&
    frame.message.includes("Subagent 配置文件更新完成")
  ) {
    const paths = (control().tracePaths ?? []).filter((path) =>
      frame.message.includes(JSON.stringify(path).slice(1, -1)),
    );
    if (paths.length)
      log({ kind: "snapshot-published", paths, readCounts: Object.fromEntries(readCounts) });
  }
  return post(...args);
};
log({ kind: "ready" });
void import(require("node:url").pathToFileURL(process.argv[2]).href);
