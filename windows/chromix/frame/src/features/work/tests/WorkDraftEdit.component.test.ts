import "$styles/global.css";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import ObjectsSheet from "./ObjectsSheet.svelte";
// Compile the lazy renderer before the interaction readiness deadline starts.
import "../components/objects/Draft.svelte";
import type { DraftView } from "../lib/board/types";

vi.mock("$shared/ipc/bindings", async () => {
  const { mockBindings } = await import("$shared/testing/bindings");
  return mockBindings({ faviconProbe: async () => true });
});

const draft: DraftView = {
  kind: "draft",
  id: "review",
  destination: "github",
  to: "crynta/terax#1337",
  body: "Request changes: the copy path skips the deny-list.",
  send: "draft",
};

test("a draft is edited where it stands, takes its review and sends through its action", async () => {
  await page.viewport(1200, 800);
  const write = vi.fn();
  const review = vi.fn();
  const send = vi.fn();
  const screen = await render(ObjectsSheet, {
    rows: [{ object: draft, width: 520 }],
    actions: { write, review, send },
  });
  await screen.getByRole("button", { name: "Edit the draft" }).first().click();
  const field = screen.getByRole("textbox").first();
  await expect.element(field).toHaveFocus();
  await userEvent.keyboard(" Please fix.");
  await userEvent.keyboard("{Escape}");
  expect(write).toHaveBeenCalledWith("review", `${draft.body} Please fix.`);
  await screen.getByRole("radio", { name: "Request changes" }).first().click();
  expect(review).toHaveBeenCalledWith("review", "request_changes");
  await screen.getByRole("button", { name: "Comment", exact: true }).first().click();
  expect(send).toHaveBeenCalledWith("review");
});

test("a draft's send reads from its run: sending holds the button, a failure returns it with the note", async () => {
  await page.viewport(1200, 800);
  const send = vi.fn();
  const sending = await render(ObjectsSheet, {
    rows: [{ object: { ...draft, send: "sending" }, width: 520 }],
    actions: { send },
  });
  await expect.element(sending.getByRole("button", { name: "Sending…" }).first()).toBeDisabled();
  await sending.unmount();
  const failed = await render(ObjectsSheet, {
    rows: [{ object: { ...draft, send: "draft", note: "Not sent: you declined it." }, width: 520 }],
    actions: { send },
  });
  await expect.element(failed.getByText("Not sent: you declined it.").first()).toBeVisible();
  await failed.getByRole("button", { name: "Comment", exact: true }).first().click();
  expect(send).toHaveBeenCalledWith("review");
});
