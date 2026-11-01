import type { ProjectSidebarView } from "@/project-sidebar/contract.js";
import { getSafeLocalStorage } from "@/lib/browserEnvironment.js";
export function readProjectSidebarView(
  storage: Pick<Storage, "getItem"> | null = getSafeLocalStorage(),
): ProjectSidebarView {
  const read = (key: string): Record<string, unknown> => {
    try {
      return JSON.parse(storage?.getItem(key) ?? "null") ?? {};
    } catch {
      return {};
    }
  };
  const current = read("cf-project-sidebar-preferences").view;
  if (current === "projects" || current === "grouped" || current === "timeline") return current;
  const legacy = read("cf-sidebar-task-preferences").organizeBy;
  return legacy === "grouped" ? "grouped" : legacy === "chronological" ? "timeline" : "projects";
}
