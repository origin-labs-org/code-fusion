import { shouldExposeE2EStoreBridge } from "@/lib/e2eStoreBridge.js";
import { useSkillStore } from "@/store/skillStore.js";
import { useSubagentsStore } from "@/store/subagentsStore.js";
import { useWhiteboardStore } from "@/store/whiteboardStore.js";
import { useCfSessionStore } from "@/store/cfSessionStore.js";

declare global {
  interface Window {
    __skillStoreE2E?: typeof useSkillStore;
    __subagentsStoreE2E?: typeof useSubagentsStore;
    __whiteboardStoreE2E?: typeof useWhiteboardStore;
    __cfSessionStoreE2E?: typeof useCfSessionStore;
  }
}

export function registerE2EStoreBridges() {
  if (!shouldExposeE2EStoreBridge()) {
    return;
  }

  window.__cfSessionStoreE2E = useCfSessionStore;
  window.__skillStoreE2E = useSkillStore;
  window.__subagentsStoreE2E = useSubagentsStore;
  window.__whiteboardStoreE2E = useWhiteboardStore;
}
