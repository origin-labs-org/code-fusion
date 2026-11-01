import {
  mapCfEnvToArmsRumEnv,
  type CfRuntimeEnv,
  CF_ARMS_RUM_ENDPOINT,
  CF_VERSION,
} from "@origin-ai/cf-shared";

export const ARMS_BROWSER_COLLECTORS = {
  perf: true,
  webvitals: true,
  exception: true,
  whiteScreen: true,
  api: true,
  staticResource: true,
  click: true,
  longTask: true,
} as const;

export function parseArmsViewName(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") {
      const fileName = parsed.pathname.split("/").pop() ?? "index.html";
      return fileName.replace(/\.html$/i, "") || "index";
    }
    const path = parsed.pathname || "/";
    return path.length > 120 ? `${path.slice(0, 120)}…` : path;
  } catch {
    return url.length > 120 ? `${url.slice(0, 120)}…` : url;
  }
}

export function buildArmsBrowserInitConfig(runtimeEnv: CfRuntimeEnv) {
  return {
    enable: CF_ARMS_RUM_ENDPOINT !== "",
    version: CF_VERSION,
    endpoint: CF_ARMS_RUM_ENDPOINT,
    env: mapCfEnvToArmsRumEnv(runtimeEnv),
    sessionConfig: {
      sampleRate: 1,
    },
    spaMode: false as const,
    parseViewName: parseArmsViewName,
    collectors: { ...ARMS_BROWSER_COLLECTORS },
  };
}
