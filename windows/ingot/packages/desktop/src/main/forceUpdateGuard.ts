import {
  DEFAULT_CF_ENDPOINT_ORIGIN,
  CF_VERSION,
  buildCfEndpointUrls,
  getForceUpdateMinimalVersionFromConfig,
  resolveForceUpdateRequirement,
  type ForceUpdateRequirement,
  type Locale,
} from "@origin-ai/cf-shared";
import { requestForceAutoUpdate, type ForceAutoUpdateState } from "./autoUpdater.js";
import { showForceUpdatePrompt } from "./forceUpdatePrompt.js";

const CF_CLIENT_CONFIG_API_PATH = "/api/v1/client/configs";
const FORCE_UPDATE_CONFIG_REQUEST_TIMEOUT_MS = 10_000;
const FORCE_UPDATE_CONFIG_MAX_RESPONSE_BYTES = 1024 * 1024;

export interface ForceUpdateDialogText {
  title: string;
  message: string;
  detail: string;
  autoUpdateButton: string;
  manualUpdateButton: string;
  quitButton: string;
}

export interface ForceUpdateGuardLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

export interface ForceUpdateGuardResult {
  blocked: boolean;
  requirement?: ForceUpdateRequirement;
}

export interface ForceUpdateGuardOptions {
  locale: Locale;
  logger: ForceUpdateGuardLogger;
  endpointOrigin?: string;
  fetchRemoteConfig?: () => Promise<unknown>;
  requestAutoUpdate?: (onStateChange?: (state: ForceAutoUpdateState) => void) => (() => void) | void;
  onBlocked?: (requirement: ForceUpdateRequirement) => void;
}

export function resolveForceUpdateClientConfigUrl(
  endpointOrigin = DEFAULT_CF_ENDPOINT_ORIGIN,
): string {
  const url = new URL(
    `${buildCfEndpointUrls(endpointOrigin).origin}${CF_CLIENT_CONFIG_API_PATH}`,
  );
  url.searchParams.set("app_version", CF_VERSION);
  url.searchParams.set("platform", `${process.platform}-${process.arch}`);
  return url.toString();
}

function getForceUpdateMinimalVersionFromClientConfig(config: unknown): string | undefined {
  if (typeof config !== "object" || config === null) {
    return undefined;
  }

  const envelope = config as {
    code?: unknown;
    data?: {
      configs?: unknown;
    };
  };
  if (typeof envelope.code === "number" && envelope.code !== 0) {
    throw new Error(`CodeFusion client config failed: ${envelope.code}`);
  }
  return getForceUpdateMinimalVersionFromConfig(envelope.data?.configs);
}

async function fetchRemoteForceUpdateConfig(
  endpointOrigin?: string,
  fetchRemoteConfig?: () => Promise<unknown>,
): Promise<unknown> {
  if (fetchRemoteConfig) {
    return fetchRemoteConfig();
  }

  const { net } = await import("electron");
  return new Promise<unknown>((resolve, reject) => {
    let request: ReturnType<typeof net.request>;
    let timer: ReturnType<typeof setTimeout>;
    let data = "";
    let receivedBytes = 0;
    let settled = false;

    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      request?.abort();
      reject(error);
    };

    const finish = (value: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    timer = setTimeout(() => {
      fail(new Error("force update config request timeout"));
    }, FORCE_UPDATE_CONFIG_REQUEST_TIMEOUT_MS);
    timer.unref?.();

    request = net.request(resolveForceUpdateClientConfigUrl(endpointOrigin));
    request.on("response", (response) => {
      const statusCode = response.statusCode ?? 0;
      if (statusCode < 200 || statusCode >= 300) {
        fail(new Error(`force update config request failed with status ${statusCode}`));
        return;
      }

      response.on("data", (chunk) => {
        receivedBytes += Buffer.byteLength(chunk);
        if (receivedBytes > FORCE_UPDATE_CONFIG_MAX_RESPONSE_BYTES) {
          fail(new Error("force update config response too large"));
          return;
        }
        data += chunk.toString();
      });
      response.on("end", () => {
        try {
          finish(JSON.parse(data));
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      });
      response.on("error", (error) => {
        fail(error instanceof Error ? error : new Error(String(error)));
      });
    });
    request.on("error", (error) => {
      fail(error instanceof Error ? error : new Error(String(error)));
    });
    request.end();
  });
}

export async function resolveDesktopForceUpdateRequirement(options: {
  logger: ForceUpdateGuardLogger;
  endpointOrigin?: string;
  fetchRemoteConfig?: () => Promise<unknown>;
}): Promise<ForceUpdateRequirement | null> {
  const resolveFromConfig = (config: unknown) =>
    resolveForceUpdateRequirement({
      currentVersion: CF_VERSION,
      forceUpdate: {
        minimalVersion:
          getForceUpdateMinimalVersionFromClientConfig(config) ??
          getForceUpdateMinimalVersionFromConfig(config) ??
          "",
      },
    });

  try {
    const remoteConfig = await fetchRemoteForceUpdateConfig(
      options.endpointOrigin,
      options.fetchRemoteConfig,
    );
    const remoteRequirement = resolveFromConfig(remoteConfig);
    if (remoteRequirement) {
      return remoteRequirement;
    }
  } catch (error) {
    options.logger.warn("[force-update] 读取远端强制升级配置失败，跳过强制升级校验", { error });
    return null;
  }

  return null;
}

export function resolveForceUpdateDownloadUrl(
  locale: Locale,
  endpointOrigin = DEFAULT_CF_ENDPOINT_ORIGIN,
): string {
  const origin = buildCfEndpointUrls(endpointOrigin).origin;
  return locale === "zh-CN" ? `${origin}/cn` : `${origin}/en`;
}

export function formatForceUpdateDialogText(
  requirement: ForceUpdateRequirement,
  locale: Locale,
): ForceUpdateDialogText {
  if (locale === "zh-CN") {
    return {
      title: "需要升级 CodeFusion",
      message: "当前版本无法继续使用",
      detail: `CurrentVersion：v${requirement.currentVersion}\n最LowAvailableVersion：v${requirement.minimalVersion}`,
      autoUpdateButton: "自动升级",
      manualUpdateButton: "手动升级",
      quitButton: "Quit",
    };
  }

  return {
    title: "Update CodeFusion",
    message: "The current version can no longer be used",
    detail: `Current version: v${requirement.currentVersion}\nMinimum supported version: v${requirement.minimalVersion}`,
    autoUpdateButton: "Auto update",
    manualUpdateButton: "Manual update",
    quitButton: "Quit",
  };
}

export async function maybeBlockStartupForForceUpdate(
  options: ForceUpdateGuardOptions,
): Promise<ForceUpdateGuardResult> {
  const requirement = await resolveDesktopForceUpdateRequirement({
    ...options,
    endpointOrigin: options.endpointOrigin,
  });
  if (!requirement) {
    return { blocked: false };
  }

  options.logger.warn("[force-update] 远端配置要求强制升级，阻止创建主窗口", requirement);
  options.onBlocked?.(requirement);
  const { app, shell } = await import("electron");
  const action = await showForceUpdatePrompt(
    formatForceUpdateDialogText(requirement, options.locale),
    options.locale,
    options.logger,
    {
      startAutoUpdate: (onStateChange) =>
        options.requestAutoUpdate?.(onStateChange) ??
        requestForceAutoUpdate(onStateChange, "force-update", requirement.minimalVersion),
    },
  );
  if (action === "auto") {
    return { blocked: true, requirement };
  }

  if (action === "manual") {
    const url = resolveForceUpdateDownloadUrl(options.locale, options.endpointOrigin);
    options.logger.info(`[force-update] User选择Manual Update：${url}`);
    await shell.openExternal(url);
  }

  app.quit();
  return { blocked: true, requirement };
}
