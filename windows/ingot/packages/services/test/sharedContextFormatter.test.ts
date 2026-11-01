import { describe, expect, it } from "vitest";
import { formatSharedContextV1 } from "../src/conversation-share/sharedContextFormatter.js";

describe("SharedContextFormatterV1", () => {
  it("Stably formats Rows and rewrites artifact ref to workspace-relative path", () => {
    const input = {
      share: { shareId: "share-1", title: "Research" },
      rows: [
        {
          rowId: 1,
          turnId: "turn-1",
          productTurnId: "product-1",
          createdAt: 1,
          createdAtSeq: 1,
          kind: "turnHeader" as const,
          origin: "userInput" as const,
          state: "completedSuccess" as const,
          startedAt: 1,
        },
        {
          rowId: 2,
          turnId: "turn-1",
          productTurnId: "product-1",
          createdAt: 2,
          createdAtSeq: 2,
          kind: "userInput" as const,
          origin: "realUser" as const,
          text: "Make a report",
        },
        {
          rowId: 3,
          turnId: "turn-1",
          productTurnId: "product-1",
          createdAt: 3,
          createdAtSeq: 3,
          kind: "artifact" as const,
          artifactVersionId: "artifact-1",
          logicalArtifactKey: "report",
          displayName: "report.pdf",
          artifactType: "pdf" as const,
          mimeType: "application/pdf",
          sizeBytes: 3,
          sha256: "a".repeat(64),
          ref: "cf-artifact://share/artifact-1",
          state: "current" as const,
        },
      ],
      installedArtifacts: [
        {
          artifactId: "artifact-1",
          workspaceRelativePath: "shared-artifacts/report.pdf",
          displayName: "report.pdf",
          mimeType: "application/pdf",
          sha256: "a".repeat(64),
        },
      ],
    };
    const first = formatSharedContextV1(input);
    expect(formatSharedContextV1(input)).toEqual(first);
    expect(first.markdown).toContain("shared-artifacts/report.pdf");
    expect(first.markdown).not.toContain("cf-artifact://");
  });

  it("Writes userInput attachments to imported model context", () => {
    const result = formatSharedContextV1({
      share: { shareId: "share-text", title: "Pasted text" },
      rows: [
        {
          rowId: 1,
          turnId: "turn-1",
          productTurnId: "product-1",
          createdAt: 1,
          createdAtSeq: 1,
          kind: "userInput" as const,
          origin: "realUser" as const,
          text: "Please analyze the pasted content",
          attachments: [
            {
              ref: "cf-artifact://share/text-1",
              fileName: "pasted-text.txt",
              mime: "text/plain",
              bytes: 4,
            },
          ],
        },
      ],
      installedArtifacts: [
        {
          artifactId: "text-1",
          workspaceRelativePath: "shared-artifacts/pasted-text.txt",
          displayName: "pasted-text.txt",
          mimeType: "text/plain",
          sha256: "b".repeat(64),
        },
      ],
    });
    expect(result.markdown).toContain("shared-artifacts/pasted-text.txt");
    expect(result.markdown).toContain("text/plain");
  });
});
