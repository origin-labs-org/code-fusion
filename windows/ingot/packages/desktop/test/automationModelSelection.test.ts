import { describe, expect, it, vi } from "vitest";
import { resolveAutomationSubmissionModelSelection } from "../src/host/automationModelSelection.js";

describe("resolveAutomationSubmissionModelSelection", () => {
  it("Reread imported config on first dispatch; cannot fall back to Workspace default on read failure, do not reread in the same run", async () => {
    const migrated = {
      providerId: "account:bigmodel-team-coding-plan",
      modelId: "GLM-5",
      options: { reasoningLevel: "high" },
    };
    const readSelection = vi.fn().mockResolvedValue(migrated);
    const getView = vi.fn().mockResolvedValue({ effectiveSelection: migrated });
    await expect(
      resolveAutomationSubmissionModelSelection({
        readSelection,
        modelSelectionService: { getView },
      }),
    ).resolves.toEqual(migrated);
    expect(getView).toHaveBeenCalledWith({ selection: migrated });
    readSelection.mockRejectedValue(new Error("migration unavailable"));
    getView.mockClear();
    await expect(
      resolveAutomationSubmissionModelSelection({
        readSelection,
        modelSelectionService: { getView },
      }),
    ).rejects.toThrow("migration unavailable");
    expect(getView).not.toHaveBeenCalled();
    readSelection.mockClear();
    await expect(
      resolveAutomationSubmissionModelSelection({
        fixedSelection: migrated,
        readSelection,
        modelSelectionService: { getView },
      }),
    ).resolves.toEqual(migrated);
    expect(readSelection).not.toHaveBeenCalled();
  });
  it("Resolve long-term config via target Host into current valid selection first, without directly pinning old account identity", async () => {
    const selection = {
      providerId: "provider-a",
      modelId: "model-a",
      options: { reasoningLevel: "high" },
    } as const;
    const effectiveSelection = { ...selection, providerId: "provider-current" };
    const getView = vi.fn().mockResolvedValue({ revision: 1, providers: [], effectiveSelection });

    await expect(
      resolveAutomationSubmissionModelSelection({ selection, modelSelectionService: { getView } }),
    ).resolves.toEqual(effectiveSelection);
    expect(getView).toHaveBeenCalledWith({ selection });
    expect(selection.providerId).toBe("provider-a");
  });

  it("Do not reread or change with account switches once pinned in the same run, even if reading current Host fails", async () => {
    const fixedSelection = {
      providerId: "old",
      modelId: "model",
      options: { reasoningLevel: "high" },
    };
    const getView = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(
      resolveAutomationSubmissionModelSelection({
        fixedSelection,
        modelSelectionService: { getView },
      }),
    ).resolves.toEqual(fixedSelection);
    expect(getView).not.toHaveBeenCalled();
  });

  it("Reject pinning when valid selection lacks model or tier; do not roll back preferredSelection", async () => {
    for (const effectiveSelection of [null, { providerId: "current", modelId: "model" }]) {
      await expect(
        resolveAutomationSubmissionModelSelection({
          selection: { providerId: "old", modelId: "model" },
          modelSelectionService: {
            getView: vi.fn().mockResolvedValue({
              revision: 1,
              providers: [],
              effectiveSelection,
              preferredSelection: {
                providerId: "other",
                modelId: "other",
                options: { reasoningLevel: "high" },
              },
            }),
          },
        }),
      ).rejects.toThrow("Automation 模型选择不可用");
    }
  });

  it("Pin target Host preferredSelection at trigger boundaries when following Workspace", async () => {
    const preferredSelection = {
      providerId: "provider-b",
      modelId: "model-b",
      options: { reasoningLevel: "high" },
    } as const;

    await expect(
      resolveAutomationSubmissionModelSelection({
        modelSelectionService: {
          getView: vi.fn().mockResolvedValue({
            revision: 3,
            providers: [],
            preferredSelection,
          }),
        },
      }),
    ).resolves.toEqual(preferredSelection);
  });

  it("Reject forming Submission when target Host has no available preferred model", async () => {
    await expect(
      resolveAutomationSubmissionModelSelection({
        modelSelectionService: {
          getView: vi.fn().mockResolvedValue({ revision: 3, providers: [] }),
        },
      }),
    ).rejects.toThrow("Automation unable to resolve preferred model from target Host.");
  });
});
