import { HISTORY_NAVIGATION_UPDATE_TAG } from "./editorUpdateTags.js";

export function shouldSlashPanelProcessUpdate(tags: ReadonlySet<string>): boolean {
  return !tags.has(HISTORY_NAVIGATION_UPDATE_TAG);
}
