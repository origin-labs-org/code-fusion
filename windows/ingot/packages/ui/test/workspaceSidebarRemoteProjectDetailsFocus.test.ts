// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { IServiceAccessor } from "@origin-ai/cf-services";
import { ServiceProvider } from "@/hooks/useServices.js";
import { ProjectNode } from "@/project-sidebar/ProjectNode.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import type { ProjectNodeProps } from "@/project-sidebar/ProjectNodeContent.js";
vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));
vi.mock("@/project-sidebar/ProjectTaskRows.js", () => ({ ProjectTaskRows: () => null }));
afterEach(cleanup);
function props(id: string): ProjectNodeProps {
  return {
    project: {
      id: "same-project",
      hostId: `remote:server:${id}`,
      name: "Project",
      roots: [{ rootPath: "/same", position: 0, isPrimary: true }],
      pinned: false,
      deleted: false,
      nameOverridden: true,
      position: 0,
      createdAt: 1,
      updatedAt: 1,
    },
    remoteHost: {
      id: `remote:server:${id}`,
      membershipId: id,
      kind: "server",
      target: { kind: "server", name: id, url: `https://${id}.test` },
      connectionStatus: "offline",
      position: 0,
    },
    deviceLabel: id,
    expanded: false,
    onExpandedChange: vi.fn(),
    tasks: [],
    availability: { online: false, entryId: id },
    onCreate: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onPin: vi.fn(),
    onMove: vi.fn(),
    onSelect: vi.fn(),
    refresh: vi.fn(async () => {}),
    onRemoveEntry: vi.fn(),
  };
}
it("Connection StatusRefreshRetainProject行菜单焦点，Connect操作Continue走现有Connect入口", async () => {
  const connect = vi.fn();
  const input = {
    ...props("Alpha"),
    additionalActions: [{ id: "connect", label: "Connect", run: connect }],
  };
  const services = {} as IServiceAccessor;
  const child = (p: ProjectNodeProps) =>
    createElement(ServiceProvider, {
      services,
      children: createElement(TooltipProvider, null, createElement(ProjectNode, p)),
    });
  const view = render(child(input));
  fireEvent.focus(screen.getByTestId("virtual-project-menu"));
  expect((await screen.findByTestId("remote-identity-details")).textContent).toContain("Alpha");
  fireEvent.keyDown(screen.getByTestId("virtual-project-menu"), { key: "ArrowDown" });
  const action = await screen.findByRole("menuitem", { name: "Connect" });
  action.focus();
  view.rerender(
    child({ ...input, remoteHost: { ...input.remoteHost!, connectionStatus: "connecting" } }),
  );
  expect(document.activeElement).toBe(action);
  expect(screen.getByTestId("project-device").textContent).toBe("Alpha");
  fireEvent.click(action);
  await waitFor(() => expect(connect).toHaveBeenCalledOnce());
});
