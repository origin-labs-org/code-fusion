import "$styles/global.css";
import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import AskReceipt from "../components/asks/AskReceipt.svelte";

const running = () =>
  document.getAnimations().filter((animation) => animation.playState === "running").length;

test("a working receipt breathes only while it can be seen", async () => {
  const screen = await render(AskReceipt, {
    tone: "working",
    status: "Sending",
    text: "Send to #design",
  });
  const receipt = screen.container.querySelector<HTMLElement>(".receipt")!;
  await expect.poll(running).toBe(1);
  // Panned far off the canvas.
  receipt.style.transform = "translateY(-100000px)";
  await expect.poll(() => receipt.querySelector(".dot")?.hasAttribute("data-still")).toBe(true);
  expect(running()).toBe(0);
  receipt.style.transform = "";
  await expect.poll(running).toBe(1);
  await screen.unmount();
});
