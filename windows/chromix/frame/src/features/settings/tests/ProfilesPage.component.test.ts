import "$styles/global.css";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import type { ProfilesView } from "$shared/ipc/bindings";
import { requestNew } from "$session/profile-sheet.svelte";
import ProfilesPage from "../components/sections/ProfilesPage.svelte";

const native = vi.hoisted(() => ({
  create: vi.fn(async () => ({ accepted: true, operation_id: null })),
}));
const roster: ProfilesView = {
  current: "01J00000000000000000000001",
  private: false,
  profiles: [
    {
      id: "01J00000000000000000000001",
      name: "Personal",
      kind: "default",
      avatar: { style: "initials", color: 1, symbol: 0, revision: 0 },
    },
  ],
};
vi.mock("$shared/ipc/bindings", async () => {
  const { mockBindings } = await import("$shared/testing/bindings");
  return mockBindings({
    profilesGet: async () => ({ status: "ok" as const, data: roster }),
    profilesCreate: native.create,
  });
});

test("New Profile from the sidebar creates and switches; from the list it only creates", async () => {
  await page.viewport(1200, 800);
  requestNew();
  let screen = await render(ProfilesPage);
  await screen.getByLabelText("Name").fill("School");
  await screen.getByRole("button", { name: "Create and Switch" }).click();
  await expect.poll(() => native.create.mock.calls.length).toBe(1);
  expect(native.create).toHaveBeenLastCalledWith(
    "School",
    expect.objectContaining({ style: "initials", photo: null }),
    true,
  );
  await screen.unmount();

  screen = await render(ProfilesPage);
  await screen.getByRole("button", { name: "New Profile…" }).click();
  await screen.getByLabelText("Name").fill("Work");
  await screen.getByRole("button", { name: "Create Profile" }).click();
  await expect.poll(() => native.create.mock.calls.length).toBe(2);
  expect(native.create).toHaveBeenLastCalledWith(
    "Work",
    expect.objectContaining({ style: "initials", photo: null }),
    false,
  );
});
