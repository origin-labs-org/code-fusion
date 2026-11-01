// ============================================================
// ============================================================
//

import { collectSites, createWorkflowProgram, spliceHoleBody } from "@origin-ai/cf-dynamic-workflow";

export function spliceHoleBodyPreview(
  scriptText: string,
  holeSiteId: string,
  body: string,
): string | undefined {
  try {
    const table = collectSites(createWorkflowProgram(scriptText));
    return spliceHoleBody(scriptText, table, holeSiteId, body)?.text;
  } catch {
    return undefined;
  }
}
