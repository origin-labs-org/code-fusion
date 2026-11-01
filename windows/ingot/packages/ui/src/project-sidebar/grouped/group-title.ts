import { CRON_DEFAULT_GROUP_ID, OFF_PEAK_DEFAULT_GROUP_ID } from "@origin-ai/cf-shared";

function getTaskGroupDisplayTitle(
  group: { id: string; title: string },
  localizedSystemTitles: { cron: string; offPeak: string },
): string {
  if (group.id === CRON_DEFAULT_GROUP_ID) return localizedSystemTitles.cron;
  if (group.id === OFF_PEAK_DEFAULT_GROUP_ID) return localizedSystemTitles.offPeak;
  return group.title;
}

export { getTaskGroupDisplayTitle };
