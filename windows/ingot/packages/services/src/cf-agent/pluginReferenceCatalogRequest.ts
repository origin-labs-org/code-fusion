import {
  cfProtocolMethods,
  cfPluginsReferenceCatalogResultSchema,
  type CfPluginsReferenceCatalogParams,
} from "@origin-ai/cf-shared";
import type { CfProtocolClient } from "#src/cf-agent/cfProtocolClient.js";

export async function requestPluginReferenceCatalog(
  client: Pick<CfProtocolClient, "request">,
  params: CfPluginsReferenceCatalogParams,
) {
  try {
    return await client.request(
      cfProtocolMethods.pluginsReferenceCatalogWithCategory,
      params,
      cfPluginsReferenceCatalogResultSchema,
    );
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === -32601))
      throw error;
    return client.request(
      cfProtocolMethods.pluginsReferenceCatalog,
      params,
      cfPluginsReferenceCatalogResultSchema,
    );
  }
}
