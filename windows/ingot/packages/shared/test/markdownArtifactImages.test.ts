import { describe, expect, it } from "vitest";

import {
  decodeMarkdownArtifactImageSource,
  extractMarkdownArtifactImageRefs,
  rewriteMarkdownArtifactImageSources,
} from "../src/markdown-artifact-images.js";

describe("Markdown artifact image references", () => {
  it("extracts only image destinations and deduplicates them", () => {
    expect(
      extractMarkdownArtifactImageRefs(
        [
          "![first](cf-artifact://session/a)",
          "[download](cf-artifact://session/not-an-image)",
          '![again](<cf-artifact://session/a> "preview")',
          "![second](cf-artifact://session/b 'title')",
        ].join("\n"),
      ),
    ).toEqual(["cf-artifact://session/a", "cf-artifact://session/b"]);
  });

  it("does not authorize image-looking text inside fenced code", () => {
    expect(
      extractMarkdownArtifactImageRefs(
        "```md\n![secret](cf-artifact://session/secret)\n```\n![ok](cf-artifact://session/ok)",
      ),
    ).toEqual(["cf-artifact://session/ok"]);
  });

  it("rewrites artifact image destinations to a harden-safe relative source", () => {
    const rewritten = rewriteMarkdownArtifactImageSources(
      "before ![shot](cf-artifact://session/shot-1) after",
    );
    expect(rewritten).not.toContain("cf-artifact://");
    const source = rewritten.match(/!\[shot\]\(([^)]+)\)/u)?.[1];
    expect(source).toBeTruthy();
    expect(decodeMarkdownArtifactImageSource(source ?? "")).toBe("cf-artifact://session/shot-1");
  });

  it("leaves normal images, links, and fenced examples unchanged", () => {
    const markdown = [
      "![web](https://example.com/image.png)",
      "[artifact](cf-artifact://session/file)",
      "```md",
      "![example](cf-artifact://session/example)",
      "```",
    ].join("\n");
    expect(rewriteMarkdownArtifactImageSources(markdown)).toBe(markdown);
  });
});
