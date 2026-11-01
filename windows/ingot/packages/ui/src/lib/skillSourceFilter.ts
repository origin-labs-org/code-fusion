import type { CfProvider } from "@origin-ai/cf-shared";

type SkillSourceType = "glm" | "unknown";

export function resolveSkillSourceType(skillPath: string): SkillSourceType {
  const normalized = skillPath.replaceAll("\\", "/").toLowerCase();
  if (normalized.includes("/.cf/skills/")) {
    return "glm";
  }
  if (normalized.includes("/.cf/cli/plugins/cache/")) {
    return "glm";
  }
  return "unknown";
}

const SKILL_ID_PROVIDER_RE = /^glm:/;

function isCfSkill(skill: { id?: string; path: string; scope?: string }): boolean {
  return (
    skill.scope === "plugin" ||
    (typeof skill.id === "string" && SKILL_ID_PROVIDER_RE.test(skill.id)) ||
    resolveSkillSourceType(skill.path) === "glm"
  );
}

export function filterSkillsForProvider<T extends { path: string; id?: string; scope?: string }>(
  skills: T[],
  _legacyProvider: CfProvider,
): T[] {
  return skills.filter(isCfSkill);
}
