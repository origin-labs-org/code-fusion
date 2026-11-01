import { useCfIntl } from "@/i18n/IntlProvider.js";
import { createPluginUiInteractions } from "@/plugin-ui/adapters/pluginUiInteractions.js";
import { usePluginUiResourceDeltaFeed } from "@/plugin-ui/adapters/pluginUiResourceDeltaFeed.js";
import { usePluginUiHost } from "@/plugin-ui/adapters/usePluginUiHost.js";
import {
  getPluginUiSurfaceFeed,
  offerPluginUiSurfaceFeed,
} from "@/plugin-ui/app/pluginUiSurfaceFeedStore.js";
import { claimPluginUiSurface } from "@/plugin-ui/app/pluginUiSurfaceStore.js";
import type {
  PluginUiPresentation,
  PluginUiSessionScope,
  PluginUiSidePaneTab,
  PluginUiSidePaneViewProps,
} from "@/plugin-ui/contract.js";
import { PLUGIN_UI_SIDE_PANE_TITLE_BAR, buildPluginUiSurfaceKey } from "@/plugin-ui/contract.js";
import { resolveSidePaneDisplayModeRequest } from "@/plugin-ui/domain/buildPluginUiHostContext.js";
import {
  EMPTY_PLUGIN_UI_SURFACE_FEED,
  buildPluginUiToolResult,
  findToolRowById,
  isPluginUiToolCancelled,
  readPluginUiToolInput,
  reducePluginUiSurfaceFeed,
} from "@/plugin-ui/domain/pluginUiToolFeed.js";
import { readPluginUiPresentation } from "@/plugin-ui/domain/readPluginUiPresentation.js";
import { useCfStoreWithDefault } from "@/store/StoreProvider.js";
import { resolveTheme } from "@/useTheme.js";
import type { PaneWorkspaceScope } from "@/v4/paneLayoutStore.js";
import type { SessionLease } from "@/v4/sessionDataLayer.js";
import { toolCallRowToLegacyNode } from "@/v4/toolCallRowAdapter.js";
import { useConversationProjection } from "@/v4/useConversationProjection.js";
import { V4PaneConversationProvider, useV4Conversation } from "@/v4/V4ConversationContext.js";
import type { McpAppsDisplayMode, PluginUiScopeRef } from "@origin-ai/cf-shared/mcp-apps";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { resolvePluginUiLogicalScope } from "../domain/pluginUiLogicalScope.js";

const FULLSCREEN_ONLY: readonly McpAppsDisplayMode[] = ["fullscreen"];
const INLINE_AND_FULLSCREEN: readonly McpAppsDisplayMode[] = ["inline", "fullscreen"];

export function usePluginUiSidePaneModel({
  tab,
  visible,
  scopeRef,
  onOpenBrowserUrl,
  onCloseTab,
}: {
  tab: PluginUiSidePaneTab;
  visible: boolean;
  scopeRef: PluginUiScopeRef;
  onOpenBrowserUrl?: (url: string) => void;
  onCloseTab?: (tabId: string) => void;
}): PluginUiSidePaneViewProps {
  const { intl, locale } = useCfIntl();
  const { layer } = useV4Conversation();
  const [lease, setLease] = useState<SessionLease | null>(null);
  const theme = useCfStoreWithDefault((state) => state.theme, "system");

  useEffect(() => {
    const nextLease = layer.acquire(tab.parentSessionId);
    setLease(nextLease);
    return () => nextLease.release();
  }, [layer, tab.parentSessionId]);
  const state = useConversationProjection(lease);
  const feedScope = useMemo<PluginUiSessionScope>(
    () => ({
      workspacePath: tab.workspacePath,
      remoteSessionId: tab.remoteSessionId,
      ...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {}),
      sessionId: tab.parentSessionId,
    }),
    [tab.parentSessionId, tab.workspaceIdentity, tab.workspacePath],
  );
  usePluginUiResourceDeltaFeed(lease?.store, feedScope);

  const surfaceKey = buildPluginUiSurfaceKey({ ...tab, sessionId: tab.parentSessionId }, scopeRef);

  const rows = state.snapshot?.rows.window ?? null;
  const row = useMemo(
    () =>
      scopeRef.kind === "toolCall" && rows ? findToolRowById(rows, scopeRef.toolCallId) : null,
    [rows, scopeRef],
  );
  const toolCall = useMemo(() => (row ? toolCallRowToLegacyNode(row).toolCall : null), [row]);
  const rowPresentation = useMemo(
    () => (toolCall ? readPluginUiPresentation(toolCall.raw) : null),
    [toolCall],
  );
  const feed = useMemo(
    () =>
      scopeRef.kind === "surface"
        ? reducePluginUiSurfaceFeed(
            getPluginUiSurfaceFeed(surfaceKey),
            rows ?? [],
            scopeRef.surfaceId,
            tab.pluginId,
            { serverName: tab.serverName, resourceUri: tab.resourceUri },
          )
        : EMPTY_PLUGIN_UI_SURFACE_FEED,
    [rows, scopeRef, surfaceKey, tab.pluginId, tab.serverName, tab.resourceUri],
  );
  useEffect(() => {
    if (scopeRef.kind === "surface") offerPluginUiSurfaceFeed(surfaceKey, feed);
  }, [feed, scopeRef.kind, surfaceKey]);
  const presentation = useMemo<PluginUiPresentation | null>(() => {
    if (scopeRef.kind === "toolCall") return rowPresentation;
    return tab.serverName
      ? { serverName: tab.serverName, pluginId: tab.pluginId, resourceUri: tab.resourceUri }
      : null;
  }, [rowPresentation, scopeRef.kind, tab.pluginId, tab.resourceUri, tab.serverName]);
  const placementKey = buildPluginUiSurfaceKey(
    { ...tab, sessionId: tab.parentSessionId },
    resolvePluginUiLogicalScope(presentation ?? {}, scopeRef),
  );
  useEffect(() => claimPluginUiSurface(placementKey, "side-pane"), [placementKey]);
  const toolInput = useMemo(
    () => (scopeRef.kind === "surface" ? feed.latest?.input : readPluginUiToolInput(toolCall)),
    [feed.latest, scopeRef.kind, toolCall],
  );
  const toolResult = useMemo(
    () =>
      scopeRef.kind === "surface"
        ? feed.result?.toolResult
        : buildPluginUiToolResult(toolCall, rowPresentation),
    [feed.result, rowPresentation, scopeRef.kind, toolCall],
  );
  const toolCallId = scopeRef.kind === "surface" ? feed.latest?.toolCallId : scopeRef.toolCallId;
  const toolCancelled =
    scopeRef.kind === "surface"
      ? feed.latest?.status === "cancelled"
      : isPluginUiToolCancelled(toolCall);
  const canReturnInline =
    Boolean(onCloseTab) && (scopeRef.kind === "surface" ? feed.latest !== null : row !== null);
  const handleDisplayModeRequest = useCallback(
    (mode: McpAppsDisplayMode) => {
      const resolved = resolveSidePaneDisplayModeRequest(mode, canReturnInline);
      if (resolved === "inline") onCloseTab?.(tab.id);
      return resolved;
    },
    [canReturnInline, onCloseTab, tab.id],
  );
  const [width, setWidth] = useState(0);
  const interactions = useMemo(
    () =>
      createPluginUiInteractions({
        workspacePath: tab.workspacePath,
        remoteSessionId: tab.remoteSessionId,
        workspaceIdentity: tab.workspaceIdentity,
        sessionId: tab.parentSessionId,
        pluginId: tab.pluginId,
        scope: scopeRef,
      }),
    [
      scopeRef,
      tab.parentSessionId,
      tab.pluginId,
      tab.workspacePath,
      tab.workspaceIdentity,
      tab.remoteSessionId,
    ],
  );
  const host = usePluginUiHost({
    presentation: presentation ?? {
      serverName: "",
      pluginId: tab.pluginId,
      resourceUri: tab.resourceUri,
    },
    scope: {
      workspacePath: tab.workspacePath,
      remoteSessionId: tab.remoteSessionId ?? undefined,
      ...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {}),
      sessionId: tab.parentSessionId,
      scope: scopeRef,
    },
    theme: resolveTheme(theme),
    locale,
    displayMode: "fullscreen",
    toolInput,
    toolResult,
    toolCallId,
    toolCancelled,
    hostVersion: "cf",
    availableDisplayModes: canReturnInline ? INLINE_AND_FULLSCREEN : FULLSCREEN_ONLY,
    onDisplayModeRequest: handleDisplayModeRequest,
    onOpenExternal: onOpenBrowserUrl,
    width,
    titleBar: PLUGIN_UI_SIDE_PANE_TITLE_BAR,
    interactions,
    enabled: presentation !== null && (scopeRef.kind === "toolCall" || rows !== null),
  });

  return {
    visible,
    scopeRef,
    host: {
      ...host,
      handle: presentation ? host.handle : null,
      phase: presentation ? host.phase : "preparing",
    },
    loadingLabel: intl.formatMessage({ id: "pluginUi.loading" }),
    errorLabel: intl.formatMessage({ id: "pluginUi.loadFailed" }),
    retryLabel: intl.formatMessage({ id: "pluginUi.retry" }),
    onWidthChange: setWidth,
  };
}

export function PluginUiConversationScope({
  tab,
  children,
}: {
  tab: PluginUiSidePaneTab;
  children: ReactNode;
}) {
  const scope = useMemo<PaneWorkspaceScope>(
    () => ({
      workspacePath: tab.workspacePath,
      ...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {}),
      ...(tab.remoteSessionId ? { remoteSessionId: tab.remoteSessionId } : {}),
    }),
    [tab.workspacePath, tab.workspaceIdentity, tab.remoteSessionId],
  );
  return <V4PaneConversationProvider scope={scope}>{children}</V4PaneConversationProvider>;
}
