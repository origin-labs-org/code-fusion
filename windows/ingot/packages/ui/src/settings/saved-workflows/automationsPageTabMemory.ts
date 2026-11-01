import type { AutomationsPageTab } from "@/settings/saved-workflows/AutomationsPageTitleSwitch.js";

const STORAGE_KEY = "cf-automations-page-tab";

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function readAutomationsPageTab(): AutomationsPageTab {
  try {
    const value = storage()?.getItem(STORAGE_KEY);
    return value === "workflow" ? "workflow" : "automation";
  } catch {
    return "automation";
  }
}

export function writeAutomationsPageTab(tab: AutomationsPageTab): void {
  try {
    storage()?.setItem(STORAGE_KEY, tab);
  } catch {
  }
}
