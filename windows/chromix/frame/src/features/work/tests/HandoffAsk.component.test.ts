import "$styles/global.css";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import SignInCard from "../components/asks/SignInCard.svelte";
import type { SignInAsk } from "../components/asks/asks";
import { notionWall } from "./ask-fixtures";

vi.mock("$shared/ipc/bindings", async () => {
  const { mockBindings } = await import("$shared/testing/bindings");
  return mockBindings({ faviconProbe: async () => true });
});

for (const kind of ["sign_in", "check"] as const) {
  test(`${kind} offers one action for the live page and no premature success`, async () => {
    const onopen = vi.fn();
    const ask: SignInAsk = {
      kind,
      step: "read-notion",
      part: null,
      host: "notion.so",
      page: notionWall,
      state: "open",
    };
    const screen = await render(SignInCard, { ask, onopen });
    const action = screen.getByRole("button", {
      name: kind === "check" ? "Open page" : "Sign in",
      exact: true,
    });
    await expect.element(action).toBeVisible();
    expect(screen.container.querySelectorAll("button")).toHaveLength(1);
    await action.click();
    expect(onopen).toHaveBeenCalledOnce();
    await screen.unmount();

    const returning = await render(SignInCard, { ask: { ...ask, state: "working" } });
    await expect.element(returning.getByRole("status")).toHaveTextContent("Continuing");
    expect(returning.container.textContent).not.toContain("Signed in");
    expect(returning.container.querySelectorAll("button")).toHaveLength(0);
    await returning.unmount();

    const failed = await render(SignInCard, { ask: { ...ask, page: null, state: "failed" } });
    await expect.element(failed.getByRole("status")).toHaveTextContent("Not done");
    await failed.unmount();
  });
}
