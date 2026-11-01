import { readFile } from "node:fs/promises";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const destructiveEntries = [
  ["BotsDialog.tsx", "bots.deleteConfirmTitle"],
  ["project-sidebar/useArchiveManagement.ts", "archives.deleteTitle"],
  ["settings/CommandsSection.tsx", "settings.commands.delete.title"],
  ["settings/AutomationsSection.tsx", "offPeak.delete.title"],
  [
    "settings/model-provider-section/modelProviderActions.ts",
    "settings.modelProvider.deleteConfirmTitle",
  ],
  ["onboarding/OnboardingDialog.tsx", "onboarding.agentsFile.confirmTitle"],
  ["settings/ShortcutSettingsSection.tsx", "settings.shortcuts.resetAllConfirmTitle"],
  ["settings/HooksSection.tsx", "settings.hooks.delete"],
  ["settings/SkillsSection.tsx", "settings.skills.delete.title"],
  ["settings/SubagentsSection.tsx", "settings.subagents.delete.title"],
  ["settings/McpSettingsSection.tsx", "settings.mcp.deleteConfirmTitle"],
] as const;

describe("全应用破坏性确认入口", () => {
  it.each(destructiveEntries)("%s\'s %s declares unrecoverable intent", async (path, titleId) => {
    const source = await readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const requests: ts.ObjectLiteralExpression[] = [];
    function visit(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        /(?:confirmDialog|requestConfirmation|confirm)$/.test(node.expression.getText(file))
      ) {
        const request = node.arguments[0];
        if (
          request &&
          ts.isObjectLiteralExpression(request) &&
          request.properties.some(
            (property) =>
              property.name?.getText(file) === "title" && property.getText(file).includes(titleId),
          )
        )
          requests.push(request);
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
    expect(requests).toHaveLength(1);
    const variant = requests[0]?.properties.find(
      (property) => property.name?.getText(file) === "confirmVariant",
    );
    expect(
      variant && ts.isPropertyAssignment(variant) && ts.isStringLiteral(variant.initializer)
        ? variant.initializer.text
        : undefined,
    ).toBe("destructive");
  });
});
