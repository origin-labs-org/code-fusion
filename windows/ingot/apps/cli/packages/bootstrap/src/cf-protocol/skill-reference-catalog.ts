import {
  cfSkillsReferenceCatalogParamsSchema,
  type CfSkillReferenceCatalogEntry,
  type CfSkillsReferenceCatalogResult,
} from "@origin-ai/cf-shared";
import type { SkillLoadOutcome, SkillMetadata } from "@origin-ai/cf-contracts";
import { listCfSkills } from "../skills.js";
import {
  parseParams,
  requireSession,
  type CfProtocolAgentServerContext,
} from "./server-types.js";

export async function getSkillReferenceCatalog(
  context: CfProtocolAgentServerContext,
  rawParams: unknown,
): Promise<CfSkillsReferenceCatalogResult> {
  const params = parseParams(cfSkillsReferenceCatalogParamsSchema, rawParams);
  if (params.sessionId) {
    const record = requireSession(context, params.sessionId);
    const outcome = await record.app.getSkillCatalog();
    return toResult("session", outcome);
  }

  const outcome = await listCfSkills({
    env: context.deps.env,
    includeVisualize: true,
    logger: context.logger,
    workingDirectory: params.workspace.workspacePath,
  });
  return toResult("workspace", outcome);
}

function toResult(
  authority: CfSkillsReferenceCatalogResult["authority"],
  outcome: SkillLoadOutcome,
): CfSkillsReferenceCatalogResult {
  return {
    authority,
    skills: outcome.skills
      .filter((skill) => skill.source !== "bundled")
      .map(toReferenceCatalogEntry),
  };
}

function toReferenceCatalogEntry(skill: SkillMetadata): CfSkillReferenceCatalogEntry {
  const scope =
    skill.source === "plugin" ? "plugin" : skill.scope === "project" ? "workspace" : "user";
  return {
    id: `glm:${scope}:${skill.path}`,
    name: skill.name,
    description: skill.description,
    path: skill.path,
    scope,
    enabled: true,
    ...(skill.pluginName ? { pluginName: skill.pluginName } : {}),
  };
}
