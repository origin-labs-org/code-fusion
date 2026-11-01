import { join } from "node:path";
import type { SkillRoot } from "@origin-ai/cf-contracts";
import { DYNAMIC_WORKFLOW_SKILL_NAME } from "./bundled-skills.js";

const SKILL_MANIFEST_FILE_NAME = "SKILL.md";

export function collectDynamicWorkflowDisabledSkillPaths(
  bundledSkillRoots: readonly SkillRoot[],
): string[] {
  return bundledSkillRoots.map((root) =>
    join(root.path, DYNAMIC_WORKFLOW_SKILL_NAME, SKILL_MANIFEST_FILE_NAME),
  );
}
