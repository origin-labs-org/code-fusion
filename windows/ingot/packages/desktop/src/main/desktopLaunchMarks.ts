import type { LaunchMarks } from "@origin-ai/cf-shared";

const launchCreatedAt =
  (typeof process.getCreationTime === "function" ? process.getCreationTime() : null) ?? Date.now();
const launchMainStart = Date.now();
let launchAppReady = launchMainStart;

export function markMainLaunchAppReady(): void {
  launchAppReady = Date.now();
}

export function getMainLaunchPartialMarks(): Omit<LaunchMarks, "loadUrl"> {
  return { createdAt: launchCreatedAt, mainStart: launchMainStart, appReady: launchAppReady };
}
