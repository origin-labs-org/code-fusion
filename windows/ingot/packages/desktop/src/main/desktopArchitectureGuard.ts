import type { BrowserWindow, NativeImage } from "electron";
import {
  DEFAULT_CF_ENDPOINT_ORIGIN,
  buildCfEndpointUrls,
  type Locale,
} from "@origin-ai/cf-shared";

export interface ArchitectureMismatch {
  
  binaryArch: string;
  
  nativeArch: string;
}

export interface DetectArchitectureMismatchOptions {
  platform?: NodeJS.Platform;
  binaryArch?: string;
  
  runningUnderARM64Translation?: boolean;
}

export function detectArchitectureMismatch(
  options: DetectArchitectureMismatchOptions = {},
): ArchitectureMismatch | null {
  const platform = options.platform ?? process.platform;
  const binaryArch = options.binaryArch ?? process.arch;
  const translated = options.runningUnderARM64Translation ?? false;

  if (!translated) {
    return null;
  }
  if (platform !== "darwin" && platform !== "win32") {
    return null;
  }

  return { binaryArch, nativeArch: "arm64" };
}

export function resolveArchitectureDownloadUrl(
  locale: Locale,
  endpointOrigin = DEFAULT_CF_ENDPOINT_ORIGIN,
): string {
  const origin = buildCfEndpointUrls(endpointOrigin).origin;
  return locale === "zh-CN" ? `${origin}/cn` : `${origin}/en`;
}

interface ArchitectureMismatchDialogText {
  title: string;
  message: string;
  detail: string;
  downloadButton: string;
  dismissButton: string;
}

export function formatArchitectureMismatchDialogText(
  mismatch: ArchitectureMismatch,
  locale: Locale,
): ArchitectureMismatchDialogText {
  const isZh = locale === "zh-CN";
  if (isZh) {
    return {
      title: "Architecture Mismatch",
      message: "The currently installed version is not compatible with this machine",
      detail:
        `你Running ${mismatch.binaryArch} Version，但Local machineYes ${mismatch.nativeArch}（Apple 芯片）架构，` +
        `CurrentPassedSystem转译Run，会更慢、更耗电。\n\n` +
        `建议前往官网下载并Install ${mismatch.nativeArch} 原生Version以获得最佳Performance。`,
      downloadButton: "Download",
      dismissButton: "暂不处理",
    };
  }

  return {
    title: "Architecture Mismatch",
    message: "The installed build does not match your machine",
    detail:
      `You are running the ${mismatch.binaryArch} build, but this machine is ${mismatch.nativeArch}. ` +
      `It is currently running through system translation, which is slower and less power-efficient.\n\n` +
      `Please download and install the native ${mismatch.nativeArch} build for the best performance.`,
    downloadButton: "Download",
    dismissButton: "Not now",
  };
}

export interface ArchitectureGuardLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

export async function maybeWarnArchitectureMismatch(options: {
  locale: Locale;
  logger: ArchitectureGuardLogger;
  parentWindow?: BrowserWindow | null;
  icon?: NativeImage;
}): Promise<void> {
  const { app, dialog, shell } = await import("electron");

  const mismatch = detectArchitectureMismatch({
    runningUnderARM64Translation: app.runningUnderARM64Translation,
  });
  if (!mismatch) {
    return;
  }

  options.logger.warn(
    `[architecture] 检测到Architecture mismatch：Run ${mismatch.binaryArch}，Local machine为 ${mismatch.nativeArch}（转译Run）`,
  );

  const text = formatArchitectureMismatchDialogText(mismatch, options.locale);
  const dialogOptions = {
    type: "warning" as const,
    buttons: [text.downloadButton, text.dismissButton],
    defaultId: 0,
    cancelId: 1,
    title: text.title,
    message: text.message,
    detail: text.detail,
    ...(options.icon && !options.icon.isEmpty() ? { icon: options.icon } : {}),
  };

  const { response } =
    options.parentWindow && !options.parentWindow.isDestroyed()
      ? await dialog.showMessageBox(options.parentWindow, dialogOptions)
      : await dialog.showMessageBox(dialogOptions);

  if (response === 0) {
    const url = resolveArchitectureDownloadUrl(options.locale);
    options.logger.info(`[architecture] User选择Go to Download：${url}`);
    await shell.openExternal(url);
  }
}
