import type { IServiceAccessor } from "@/hooks/useServices.js";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ServiceProvider } from "@/hooks/useServices.js";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";
import { WorkspaceFileSearchSection } from "@/settings/WorkspaceFileSearchSection.js";

const emptyAccessor = {} as unknown as IServiceAccessor;

function renderSection(props: { workspacePath?: string | null }): string {
  return renderToStaticMarkup(
    createElement(
      ServiceProvider,
      { services: emptyAccessor },
      createElement(
        CfIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(WorkspaceFileSearchSection, props),
      ),
    ),
  );
}

describe("WorkspaceFileSearch settings section", () => {
  it("renders a hint instead of the editor when no workspace is open", () => {
    const html = renderSection({ workspacePath: null });
    expect(html).toContain("Current没有打开的Workspace");
    expect(html).not.toContain("workspace-file-search-ignore-editor");
  });

  it("wires the ignore editor to the fileService RPC contract", () => {
    const source = readFileSync(
      new URL("../src/settings/WorkspaceFileSearchSection.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("readWorkspaceFileSearchIgnore");
    expect(source).toContain("writeWorkspaceFileSearchIgnore");
    expect(source).toContain("applyWorkspaceFileSearchIgnoreTransform({");
    expect(source).toContain("transform,");
    expect(source).not.toContain("readTextFile");
    expect(source).not.toContain("window.cf");
  });
});
