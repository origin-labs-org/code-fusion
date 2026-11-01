import { execFile } from "node:child_process";
import type { WindowsTaskkillRunner } from "#src/process/processTreeTypes.js";

export const defaultWindowsTaskkillRunner: WindowsTaskkillRunner = ({ force, pid, timeoutMs }) =>
  new Promise((resolve) => {
    execFile(
      "taskkill",
      ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])],
      { encoding: "utf8", timeout: timeoutMs, windowsHide: true },
      (error, _stdout, stderr) => {
        resolve({ ...(error ? { error } : {}), ...(stderr ? { stderr } : {}) });
      },
    );
  });
