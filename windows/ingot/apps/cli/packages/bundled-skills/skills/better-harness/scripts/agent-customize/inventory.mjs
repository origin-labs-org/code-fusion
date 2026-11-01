export {
  filterManageItems,
  groupManageItems,
  tabAvailableForScope,
} from "./core/items.mjs";
import { collectProviderInventory } from "./providers/index.mjs";

export async function collectAgentCustomizeInventory(options = {}) {
  const provider = options.provider ?? "cursor";
  return collectProviderInventory(provider, options);
}

export const collectCustomizeInventory = collectAgentCustomizeInventory;
