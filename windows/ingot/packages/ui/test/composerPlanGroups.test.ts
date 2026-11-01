import type { ProviderSettingsView } from "@origin-ai/cf-services";
import { describe, expect, it } from "vitest";
import { buildComposerPlanGroups, composerConnectionKey } from "@/lib/composerPlanGroups.js";
import { BUILTIN_MODEL_PROVIDER_IDS as IDS } from "@origin-ai/cf-shared";
const personal = {
  key: `registry-provider:${IDS.bigmodelIndividualCodingPlan}`,
  label: "BigModel",
  labelBadge: "Individual",
  items: [{ key: "m", value: "m", name: "GLM-5.3" }],
};
const team = {
  ...personal,
  key: `registry-provider:${IDS.bigmodelTeamCodingPlan}`,
  labelBadge: "Team",
};
const api = { key: "api", label: "DeepSeek", labelBadge: "API", items: [] };
const product = {
  family: "bigmodel" as const,
  productId: "p",
  subscribed: true,
  teamProjects: [
    { organizationId: "o", projectId: "j", organizationName: "Team One" },
    { organizationId: "o2", projectId: "j2", organizationName: "Team Two" },
  ],
};
describe("Composer concrete team provider rows", () => {
  it.each(["unavailable", "unknown", "available", undefined] as const)(
    "按 Provider 权威状态过滤菜单：%s",
    (availability) => {
      const settings = {
        providers: [
          { providerId: IDS.bigmodelTeamCodingPlan, accountState: { availability } },
          { providerId: IDS.bigmodelIndividualCodingPlan, accountState: { availability } },
        ],
      } as unknown as ProviderSettingsView;
      const result = buildComposerPlanGroups([personal, team, api], [product], settings);
      expect(result.map((g) => g.key)).toEqual(
        availability === "unavailable"
          ? [expect.any(String), expect.any(String), api.key]
          : [personal.key, expect.any(String), expect.any(String), api.key],
      );
    },
  );
  it.each([true, false])(
    "Current team unavailable only hides that identity; other teams remain selectable (catalog arrived: %s)",
    (hasCatalog) => {
      const selection = {
        kind: "team-coding-plan" as const,
        productId: "p",
        organizationId: "o",
        projectId: "j",
      };
      const settings = {
        providers: [
          {
            providerId: IDS.bigmodelTeamCodingPlan,
            enabled: true,
            effectiveConfig: {
              access: { type: "zhipu-account", accountType: "bigmodel", mode: "team-coding-plan" },
              api: { type: "anthropic-messages" },
            },
            accountState: { availability: "unavailable" },
          },
        ],
      } as unknown as ProviderSettingsView;
      const groups = buildComposerPlanGroups(
        hasCatalog ? [personal, team, api] : [personal, api],
        [product],
        settings,
        "glm",
        {},
        { bigmodel: selection },
      );
      expect(groups.some((g) => g.key === composerConnectionKey("bigmodel", selection))).toBe(
        false,
      );
      const other = groups.find((g) => g.labelBadge === "Team Two");
      expect(other?.connection?.selection).toEqual({
        kind: "team-coding-plan",
        productId: "p",
        organizationId: "o2",
        projectId: "j2",
      });
      expect(other?.connection?.disabled).not.toBe(true);
    },
  );
  it.each([
    ["个人", "团队"],
    ["Individual", "Team"],
  ])("Supplemental inactive personal plan reuses current language %s", (personalLabel, teamLabel) => {
    const settings = {
      providers: [
        {
          providerId: IDS.bigmodelIndividualCodingPlan,
          enabled: true,
          effectiveConfig: {
            access: {
              type: "zhipu-account",
              accountType: "bigmodel",
              mode: "individual-coding-plan",
              entitled: true,
            },
            api: { type: "anthropic-messages" },
          },
          accountState: { availability: "available", entitled: true },
        },
      ],
    } as unknown as ProviderSettingsView;
    const result = buildComposerPlanGroups([team, api], [product], settings, "glm", {
      codingPlanBadgeLabel: personalLabel,
      teamPlanBadgeLabel: teamLabel,
    });
    expect(result[0]?.labelBadge).toBe(personalLabel);
    expect(result[1]?.labelBadge).toBe("Team One");
  });
  it("Each fully purchased team appears as its own row, preserving branding and real labels without API merging", () => {
    const groups = buildComposerPlanGroups([personal, team, api], [product]);
    expect(groups.map((g) => [g.label, g.labelBadge])).toEqual([
      ["BigModel", "Individual"],
      ["BigModel", "Team One"],
      ["BigModel", "Team Two"],
      ["DeepSeek", "API"],
    ]);
    expect(groups[1]?.connection?.selection).toEqual({
      kind: "team-coding-plan",
      productId: "p",
      organizationId: "o",
      projectId: "j",
    });
    expect(groups[3]).toBe(api);
  });
  it("Retain different identities with the same name, deduplicate duplicate identities, and hide unpurchased or incomplete teams", () => {
    const same = {
      ...product,
      teamProjects: product.teamProjects.map((p) => ({ ...p, organizationName: "Same" })),
    };
    const groups = buildComposerPlanGroups(
      [personal, team, api],
      [
        same,
        same,
        { ...product, subscribed: false },
        {
          ...product,
          productId: "bad",
          teamProjects: [{ organizationId: "o", projectId: "", organizationName: "Bad" }],
        },
      ],
    );
    expect(groups.filter((g) => g.connection?.selection?.kind === "team-coding-plan")).toHaveLength(
      2,
    );
    expect(groups[1]?.key).not.toBe(groups[2]?.key);
  });
  it("Retain original team row when current team catalog has not arrived yet, without disguising as personal", () => {
    expect(buildComposerPlanGroups([personal, team, api], []).map((g) => g.key)).toEqual([
      personal.key,
      team.key,
      api.key,
    ]);
  });
  it("Unselected teams with unknown quotas can still be discovered from purchased catalog; hidden when Agent format is incompatible", () => {
    const settings = {
      providers: [
        {
          providerId: IDS.bigmodelTeamCodingPlan,
          enabled: true,
          effectiveConfig: {
            access: { type: "zhipu-account", accountType: "bigmodel", mode: "team-coding-plan" },
            api: { type: "anthropic-messages" },
          },
          accountState: { availability: "unknown", entitled: false },
        },
      ],
    } as unknown as ProviderSettingsView;
    expect(
      buildComposerPlanGroups([personal, api], [product], settings).filter(
        (g) => g.connection?.selection?.kind === "team-coding-plan",
      ),
    ).toHaveLength(2);
    expect(
      buildComposerPlanGroups([personal, api], [product], settings, "codex").filter(
        (g) => g.connection?.selection?.kind === "team-coding-plan",
      ),
    ).toHaveLength(0);
  });
  it("Hide explicitly unavailable teams without falling back to a generic Team row; keep unknown and available items", () => {
    const unavailable = {
      ...product,
      teamProjects: product.teamProjects.map((p) => ({ ...p, apiKeyStatus: "unavailable" })),
    };
    expect(buildComposerPlanGroups([personal, team, api], [unavailable]).map((g) => g.key)).toEqual(
      [personal.key, api.key],
    );
    const mixed = {
      ...product,
      apiKeyStatus: "unavailable",
      teamProjects: [
        { ...product.teamProjects[0]!, apiKeyStatus: "unknown" },
        { ...product.teamProjects[1]!, apiKeyStatus: "available" },
      ],
    };
    expect(
      buildComposerPlanGroups([personal, team, api], [mixed]).filter(
        (g) => g.connection?.selection?.kind === "team-coding-plan",
      ),
    ).toHaveLength(2);
    expect(
      buildComposerPlanGroups(
        [personal, team, api],
        [{ ...product, apiKeyStatus: "unavailable" }],
      ).map((g) => g.key),
    ).toEqual([personal.key, api.key]);
  });
});
