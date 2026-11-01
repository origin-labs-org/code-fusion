// @vitest-environment jsdom
import { createElement, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RemoteConnectionHistoryInput } from "@/remote-connection/RemoteConnectionHistoryInput.js";

afterEach(cleanup);
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
function History() {
  const [value, onChange] = useState("");
  return createElement(RemoteConnectionHistoryInput, {
    label: "Host",
    placeholder: "Host",
    value,
    onChange,
    suggestions: ["alpha.test", "beta.test"],
    emptyText: "Empty",
  });
}
it("History input retains focus, up/down keys select, Enter fills and closes", () => {
  render(createElement(History));
  const input = screen.getByRole("combobox", { name: "Host" });
  act(() => input.focus());
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(screen.getByRole("option", { selected: true }).textContent).toBe("beta.test");
  expect(document.activeElement).toBe(input);
  expect(document.getElementById(input.getAttribute("aria-activedescendant")!)?.textContent).toBe(
    "beta.test",
  );
  fireEvent.keyDown(input, { key: "Enter" });
  expect((input as HTMLInputElement).value).toBe("beta.test");
  expect(input.getAttribute("aria-expanded")).toBe("false");
});

it("Escape closes history without submitting or clearing field; Tab preserves native focus movement", () => {
  render(createElement(History));
  const input = screen.getByRole("combobox", { name: "Host" });
  act(() => input.focus());
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input.getAttribute("aria-expanded")).toBe("false");
  expect((input as HTMLInputElement).value).toBe("");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Tab" });
  expect(input.getAttribute("aria-expanded")).toBe("false");
});
