// @vitest-environment jsdom
import { act, createElement } from "react";

import { expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { RollingToolbarLabel } from "@/chat-input-toolbar/RollingToolbarLabel.js";

it.each([false, true])("Provider and model share a single truncated line when system reduce-motion=%s", async (reducedMotion) => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: reducedMotion,
    addEventListener() {},
    removeEventListener() {},
  }));
  try {
    await act(async () =>
      root.render(
        createElement(RollingToolbarLabel, {
          label: "ZAPI (Anthropic) / GLM-5.3-Highspeed-fusion",
          prefix: "ZAPI (Anthropic) / ",
          prefixClassName: "inline",
          value: "GLM-5.3-Highspeed-fusion",
        }),
      ),
    );
    const lines = host.querySelectorAll(":scope > span > span");
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toBe("ZAPI (Anthropic) / GLM-5.3-Highspeed-fusion");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
