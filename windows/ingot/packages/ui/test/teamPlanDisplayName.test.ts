import { describe, expect, it } from "vitest";
import { formatTeamPlanDisplayName } from "@/lib/teamPlanDisplayName.js";

describe("formatTeamPlanDisplayName", () => {
  it("Prefer displaying organization name only", () => {
    expect(
      formatTeamPlanDisplayName({
        organizationId: "123245",
        organizationName: "Organization",
        projectId: "project-a",
        projectName: "Project",
      }),
    ).toBe("Organization");
  });

  it("Do not fall back to displaying ID or project info when organization name is absent", () => {
    expect(
      formatTeamPlanDisplayName({
        organizationId: "123245",
        projectId: "project-a",
        projectName: "Project",
      }),
    ).toBeNull();
  });
});
