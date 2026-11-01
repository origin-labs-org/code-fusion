import armsRum from "@arms/rum-electron/browser";
import type { CfRuntimeEnv } from "@origin-ai/cf-shared";
import { buildArmsBrowserInitConfig } from "./armsRumShared.js";

let bootstrapped = false;

export function initArmsBrowserRumOnce(runtimeEnv: CfRuntimeEnv): boolean {
  if (bootstrapped) {
    return true;
  }

  const bridge =
    typeof globalThis !== "undefined" &&
    (globalThis as { ArmsEventBridge?: { send?: unknown } }).ArmsEventBridge;
  const winBridge =
    typeof window !== "undefined" &&
    (window as { ArmsEventBridge?: { send?: (payload: string) => void } }).ArmsEventBridge;
  const resolved = bridge || winBridge;
  if (!resolved || typeof resolved.send !== "function") {
    return false;
  }

  bootstrapped = true;
  try {
    armsRum.init(buildArmsBrowserInitConfig(runtimeEnv));
  } catch (error) {
    bootstrapped = false;
    console.warn("[arms] renderer RUM init failed:", error);
    return false;
  }

  if (typeof document !== "undefined" && document.readyState === "complete") {
    window.dispatchEvent(new Event("load"));
  }
  return true;
}

export function scheduleArmsBrowserRumInit(runtimeEnv: CfRuntimeEnv, maxAttempts = 50): void {
  let attempts = 0;
  const tick = (): void => {
    if (initArmsBrowserRumOnce(runtimeEnv)) {
      return;
    }
    attempts += 1;
    if (attempts < maxAttempts) {
      setTimeout(tick, 0);
    } else {
      console.warn("[arms] ArmsEventBridge 不可用，跳过 renderer RUM 初始化");
    }
  };
  tick();
}
