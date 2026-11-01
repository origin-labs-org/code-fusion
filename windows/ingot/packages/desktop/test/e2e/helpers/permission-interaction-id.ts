import { TID_TOOL_SUMMARY_TRIGGER, testId } from "@origin-ai/cf-shared/test-ids";

export const PERMISSION_INTERACTION_PREFIX = testId(TID_TOOL_SUMMARY_TRIGGER, "permission:");

export function readPermissionInteractionIdsInBrowser(prefix: string): string[] {
  const ids = Array.from(document.querySelectorAll<HTMLElement>("[data-testid]"))
    .filter((node) => node.getClientRects().length > 0)
    .map((node) => node.dataset.testid ?? "")
    .filter((id) => id.startsWith(prefix) && id.length > prefix.length)
    .map((id) => id.slice(prefix.length));
  return [...new Set(ids)];
}

export async function waitForPermissionInteractionId(caseMarker: string): Promise<string> {
  let ids: string[] = [];
  await browser.waitUntil(
    async () => {
      ids = await browser.execute(
        readPermissionInteractionIdsInBrowser,
        PERMISSION_INTERACTION_PREFIX,
      );
      return ids.length === 1;
    },
    { timeout: 30_000, timeoutMsg: `${caseMarker}: 没有唯One可见的Permission request ID` },
  );
  return ids[0]!;
}
