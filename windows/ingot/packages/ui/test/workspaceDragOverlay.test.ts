import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";
import { WorkspaceDragOverlay } from "@/project-sidebar/WorkspaceDragOverlay.js";

vi.mock("@/hooks/useSourceServerDisplayNames.js", () => ({
  useSourceServerDisplayNames: () => new Map([["source-a", "Build device"]]),
}));
it("Drag-and-drop preview使用DeviceShow名且RetainProject名，LocalProject不ShowDeviceTags", () => {
  const render = (remote: boolean) =>
    renderToStaticMarkup(
      createElement(
        CfIntlProvider,
        { initialLocale: "en-US" },
        createElement(WorkspaceDragOverlay, {
          width: 264,
          tab: {
            id: "a",
            kind: "workspace",
            label: "project",
            workspacePath: "/project",
            ...(remote ? { workspaceIdentity: "remote:server:source-a:/project" } : {}),
          },
        }),
      ),
    );
  expect(render(true)).toContain("Build device");
  expect(render(true)).toContain("project");
  expect(render(false)).not.toContain("data-workspace-drag-device");
});

it("legacy Project拖拽沿用普通Project行投影出的DeviceNew name", () => {
  const html = renderToStaticMarkup(
    createElement(
      CfIntlProvider,
      { initialLocale: "en-US" },
      createElement(WorkspaceDragOverlay, {
        width: 264,
        sourceDisplayName: "Renamed device",
        tab: {
          id: "legacy",
          kind: "workspace",
          label: "project",
          workspacePath: "/project",
          workspaceIdentity: "remote:ssh:old:22:dev:/project",
          remoteTarget: { kind: "ssh", host: "old", username: "dev" },
        },
      }),
    ),
  );
  expect(html).toContain("Renamed device");
});
