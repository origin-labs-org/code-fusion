import type { BrowserWindow } from "electron";
import {
  type ExternalWorkspaceOpenDialogCopy,
  confirmExternalWorkspaceOpen,
  isNetworkWorkspacePath,
  isValidLocalWorkspaceDirectory,
} from "./desktopOAuthDeepLink.js";
import {
  createOpenWorkspaceStartupBootstrap,
  type StartupWindowBootstrap,
} from "./startupWorkspace.js";

export type ExplicitStartupWorkspaceSource = "open-workspace-arg" | "deep-link";

export interface ExplicitStartupWorkspaceRequest {
  path: string;
  source: ExplicitStartupWorkspaceSource;
}

export interface StartupDeepLinkConsumptionGate {
  markStartupRequestConsumed: (request: ExplicitStartupWorkspaceRequest) => void;
  shouldHandleReadyProtocolUrl: (protocolUrl: string | null) => boolean;
}

interface ResolveExplicitStartupWorkspaceBootstrapDeps {
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };
  confirmationCopy?: ExternalWorkspaceOpenDialogCopy;
  parentWindow?: BrowserWindow | null;
}

export function createStartupDeepLinkConsumptionGate(
  startupProtocolUrl: string | null,
): StartupDeepLinkConsumptionGate {
  let startupDeepLinkConsumed = false;

  return {
    markStartupRequestConsumed: (request) => {
      if (request.source !== "deep-link") {
        return;
      }

      startupDeepLinkConsumed = true;
    },
    shouldHandleReadyProtocolUrl: (protocolUrl) => {
      if (!protocolUrl) {
        return false;
      }

      return !(startupDeepLinkConsumed && protocolUrl === startupProtocolUrl);
    },
  };
}

export function resolveExplicitStartupWorkspaceBootstrap(
  request: ExplicitStartupWorkspaceRequest,
  deps: ResolveExplicitStartupWorkspaceBootstrapDeps,
): StartupWindowBootstrap | null {
  if (request.source === "deep-link") {
    if (isNetworkWorkspacePath(request.path)) {
      deps.logger.warn("[deep-link] 网络工作区路径Rejected", { path: request.path });
      return null;
    }

    if (
      !confirmExternalWorkspaceOpen(
        request.path,
        deps.logger,
        deps.parentWindow ?? null,
        deps.confirmationCopy,
      )
    ) {
      return null;
    }
  }

  if (!isValidLocalWorkspaceDirectory(request.path)) {
    deps.logger.warn("[startup-workspace] open-workspace argv invalid, falling back", {
      path: request.path,
    });
    return null;
  }

  deps.logger.info("[startup-workspace] using explicit open workspace:", request.path);
  return createOpenWorkspaceStartupBootstrap(request.path);
}
