// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { mergeProjectTrees, projectKey, selectSortedProjects } from "@/project-sidebar/view.js";
import { useProjectSidebarPreferences } from "@/project-sidebar/useProjectSidebarPreferences.js";
import type { VirtualProject } from "@/project-sidebar/contract.js";

const storageKey = "cf-project-sidebar-preferences";
const project = (id: string, position: number, hostId = "local"): VirtualProject => ({
  id,
  name: id,
  hostId,
  position,
  roots: [{ rootPath: "/same", position: 0, isPrimary: true }],
  nameOverridden: false,
  pinned: false,
  deleted: false,
  createdAt: 1,
  updatedAt: 1,
});
function snapshot(online: boolean, migrated = true) {
  const hostId = online ? "remote:server:source" : "remote:ssh:example.test:22:dev";
  const remote = project("remote", 0, hostId);
  return mergeProjectTrees(
    { projects: [project("a", 0), project("b", 2)], tasks: [] },
    {
      hosts: [{ id: hostId, membershipId: "m", kind: "ssh", target: null, position: 0 }],
      entries: [
        {
          id: "entry",
          hostId,
          projectId: online ? remote.id : null,
          name: "remote",
          roots: remote.roots,
          lastSyncedAt: online ? 1 : null,
          legacyWorkspace: {
            kind: "remote",
            workspacePath: "/same",
            target: { kind: "ssh", host: "example.test", username: "dev" },
            lastOpenedAt: 1,
            lastConnectionStatus: "failed",
          },
          ...(migrated ? { initialPosition: 1 } : {}),
        },
      ],
    },
    online ? new Map([[hostId, { projects: [remote], tasks: [] }]]) : new Map(),
  );
}
const props = (online: boolean, migrated = true) => {
  const result = snapshot(online, migrated);
  return { projects: selectSortedProjects(result.tree), availability: result.availability };
};
const names = (projects: VirtualProject[]) => projects.map((p) => p.name);
afterEach(() => {
  cleanup();
  localStorage.clear();
});

it("First upgrade remote 2nd position: offline, Source identity binding, project resolution, and reload stay in place", () => {
  const offline = props(false);
  expect(names(offline.projects)).toEqual(["a", "remote", "b"]);
  const hook = renderHook(
    ({ projects, availability }) => useProjectSidebarPreferences(projects, false, availability),
    { initialProps: offline },
  );
  const online = props(true);
  hook.rerender(online);
  expect(names(hook.result.current.sort(online.projects))).toEqual(["a", "remote", "b"]);
  const expected = online.projects.map(projectKey);
  expect(hook.result.current.order).toEqual(expected);
  expect(JSON.parse(localStorage.getItem(storageKey)!).order).toEqual(expected);
  hook.unmount();
  const reopened = renderHook(() =>
    useProjectSidebarPreferences(online.projects, false, online.availability),
  );
  expect(reopened.result.current.order).toEqual(expected);
});

it("Position dragged offline by user takes precedence over initial index after first upgrade; connection and repeated refreshes do not reorder", () => {
  const offline = props(false);
  const hook = renderHook(
    ({ projects, availability }) => useProjectSidebarPreferences(projects, false, availability),
    { initialProps: offline },
  );
  act(() =>
    hook.result.current.reorder(
      offline.projects,
      projectKey(offline.projects[1]!),
      projectKey(offline.projects[0]!),
    ),
  );
  const online = props(true);
  hook.rerender(online);
  expect(names(hook.result.current.sort(online.projects))).toEqual(["remote", "a", "b"]);
  const order = hook.result.current.order;
  hook.rerender(props(true));
  expect(hook.result.current.order).toBe(order);
});

it("Existing entries without first-upgrade flag do not execute sort repair; local projects with the same path are unaffected", () => {
  const offline = props(false, false);
  const hook = renderHook(
    ({ projects, availability }) => useProjectSidebarPreferences(projects, false, availability),
    { initialProps: offline },
  );
  const before = hook.result.current.order;
  const online = props(true, false);
  hook.rerender(online);
  expect(hook.result.current.order).toEqual([
    ...before,
    projectKey(online.projects.find((p) => p.name === "remote")!),
  ]);
  expect(names(hook.result.current.sort(online.projects))).toEqual(["a", "b", "remote"]);
});
