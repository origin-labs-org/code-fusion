import { useCfStoreWithDefault } from "@/store/StoreProvider.js";

export function useIsOfficeMode(): boolean {
  return useCfStoreWithDefault((state) => state.interfaceMode === "office", false);
}
