import { contextBridge } from "electron";
import { installRewardsPageBridge, isTrustedRewardsUrl } from "@origin-ai/cf-shared";

if (
  isTrustedRewardsUrl(window.location.href, {
    dev: process.argv.includes("--cf-rewards-dev"),
    e2e: process.env.VITE_CF_E2E_STORE_BRIDGE === "1",
  })
) {
  contextBridge.executeInMainWorld({ func: installRewardsPageBridge, args: [] });
}
