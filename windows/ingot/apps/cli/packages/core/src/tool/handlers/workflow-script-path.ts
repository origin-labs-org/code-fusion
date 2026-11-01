// ============================================================
// ============================================================
//

import path from "node:path";

export function describeWorkflowScriptPath(absolutePath: string, cwd: string | undefined): string {
  if (cwd === undefined || cwd === "") return absolutePath;
  const relative = path.relative(cwd, absolutePath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return absolutePath;
  }
  return relative;
}
