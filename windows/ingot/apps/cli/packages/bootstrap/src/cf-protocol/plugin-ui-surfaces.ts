import {
  cfPluginsListUiSurfacesParamsSchema,
  type CfPluginUiSurface,
  type CfPluginsListUiSurfacesResult,
} from "@origin-ai/cf-shared";
import type { PluginMetadata } from "@origin-ai/cf-contracts";
import { resolveCfPlugins } from "../plugins.js";
import { parseParams, type CfProtocolAgentServerContext } from "./server-types.js";

export function listPluginUiSurfacesFromPlugins(
  plugins: readonly PluginMetadata[],
): CfPluginUiSurface[] {
  const surfaces: CfPluginUiSurface[] = [];
  for (const plugin of plugins) {
    if (!plugin.enabled) continue;
    for (const surface of plugin.uiSurfaces ?? []) {
      surfaces.push({
        pluginId: plugin.id,
        pluginName: plugin.name,
        id: surface.id,
        title: surface.title,
        ...(surface.icon ? { icon: surface.icon } : {}),
        server: surface.server,
        resourceUri: surface.resourceUri,
        availability: surface.availability,
      });
    }
  }
  return surfaces;
}

export async function listPluginUiSurfaces(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
): Promise<CfPluginsListUiSurfacesResult> {
  const params = parseParams(cfPluginsListUiSurfacesParamsSchema, rawParams);
  const outcome = resolveCfPlugins({
    logger: context.logger,
    workingDirectory: params.workspace.workspacePath,
  });
  return { surfaces: listPluginUiSurfacesFromPlugins(outcome.plugins) };
}
