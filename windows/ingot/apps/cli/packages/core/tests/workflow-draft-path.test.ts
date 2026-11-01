import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  isPreapprovedWorkflowDraftWrite,
  isWorkflowDraftPath,
} from "../src/permission/workflow-draft-path.js";

const WORKING_DIRECTORY = "/ws/project";

describe("isWorkflowDraftPath", () => {
  it("accepts a relative path resolved against the working directory", () => {
    expect(
      isWorkflowDraftPath({
        filePath: ".cf/workflow-drafts/report.dwf.ts",
        pathModule: path.posix,
        workingDirectory: WORKING_DIRECTORY,
      }),
    ).toBe(true);
  });

  it("accepts an absolute path inside the drafts directory", () => {
    expect(
      isWorkflowDraftPath({
        filePath: "/ws/project/.cf/workflow-drafts/report.dwf.ts",
        pathModule: path.posix,
        workingDirectory: WORKING_DIRECTORY,
      }),
    ).toBe(true);
  });

  it("accepts a file nested below the drafts directory", () => {
    expect(
      isWorkflowDraftPath({
        filePath: ".cf/workflow-drafts/nested/report.dwf.ts",
        pathModule: path.posix,
        workingDirectory: WORKING_DIRECTORY,
      }),
    ).toBe(true);
  });

  it("rejects the drafts directory itself", () => {
    expect(
      isWorkflowDraftPath({
        filePath: ".cf/workflow-drafts",
        pathModule: path.posix,
        workingDirectory: WORKING_DIRECTORY,
      }),
    ).toBe(false);
  });

  it("rejects a traversal that climbs back out of the drafts directory", () => {
    expect(
      isWorkflowDraftPath({
        filePath: ".cf/workflow-drafts/../../secrets.env",
        pathModule: path.posix,
        workingDirectory: WORKING_DIRECTORY,
      }),
    ).toBe(false);
  });

  it("rejects a sibling directory that merely shares the name prefix", () => {
    expect(
      isWorkflowDraftPath({
        filePath: ".cf/workflow-drafts-other/report.dwf.ts",
        pathModule: path.posix,
        workingDirectory: WORKING_DIRECTORY,
      }),
    ).toBe(false);
  });

  it("rejects the sibling definitions directory", () => {
    expect(
      isWorkflowDraftPath({
        filePath: ".cf/workflows/report.dwf.ts",
        pathModule: path.posix,
        workingDirectory: WORKING_DIRECTORY,
      }),
    ).toBe(false);
  });

  it("rejects another project's drafts directory", () => {
    expect(
      isWorkflowDraftPath({
        filePath: "/ws/other/.cf/workflow-drafts/report.dwf.ts",
        pathModule: path.posix,
        workingDirectory: WORKING_DIRECTORY,
      }),
    ).toBe(false);
  });

  it("rejects an empty working directory and an empty file path", () => {
    expect(
      isWorkflowDraftPath({
        filePath: ".cf/workflow-drafts/report.dwf.ts",
        pathModule: path.posix,
        workingDirectory: "",
      }),
    ).toBe(false);
    expect(
      isWorkflowDraftPath({
        filePath: "",
        pathModule: path.posix,
        workingDirectory: WORKING_DIRECTORY,
      }),
    ).toBe(false);
  });

  it("uses the current platform's path module by default", () => {
    expect(
      isWorkflowDraftPath({
        filePath: path.join(".cf", "workflow-drafts", "report.dwf.ts"),
        workingDirectory: path.resolve("ws", "project"),
      }),
    ).toBe(true);
  });

  describe("on Windows paths", () => {
    const windowsWorkingDirectory = "C:\\ws\\project";

    it("accepts a backslash-separated path inside the drafts directory", () => {
      expect(
        isWorkflowDraftPath({
          filePath: ".cf\\workflow-drafts\\report.dwf.ts",
          pathModule: path.win32,
          workingDirectory: windowsWorkingDirectory,
        }),
      ).toBe(true);
    });

    it("accepts a drive-qualified absolute path inside the drafts directory", () => {
      expect(
        isWorkflowDraftPath({
          filePath: "C:\\ws\\project\\.cf\\workflow-drafts\\report.dwf.ts",
          pathModule: path.win32,
          workingDirectory: windowsWorkingDirectory,
        }),
      ).toBe(true);
    });

    it("rejects a path on another drive", () => {
      expect(
        isWorkflowDraftPath({
          filePath: "D:\\ws\\project\\.cf\\workflow-drafts\\report.dwf.ts",
          pathModule: path.win32,
          workingDirectory: windowsWorkingDirectory,
        }),
      ).toBe(false);
    });

    it("rejects a backslash traversal out of the drafts directory", () => {
      expect(
        isWorkflowDraftPath({
          filePath: ".cf\\workflow-drafts\\..\\..\\secrets.env",
          pathModule: path.win32,
          workingDirectory: windowsWorkingDirectory,
        }),
      ).toBe(false);
    });

    it("rejects a sibling directory that merely shares the name prefix", () => {
      expect(
        isWorkflowDraftPath({
          filePath: ".cf\\workflow-drafts-other\\report.dwf.ts",
          pathModule: path.win32,
          workingDirectory: windowsWorkingDirectory,
        }),
      ).toBe(false);
    });
  });
});

describe("isPreapprovedWorkflowDraftWrite", () => {
  const draftWrite = {
    input: { file_path: ".cf/workflow-drafts/report.dwf.ts" },
    pathModule: path.posix,
    workingDirectory: WORKING_DIRECTORY,
  };

  it("covers Edit and Write", () => {
    expect(isPreapprovedWorkflowDraftWrite({ ...draftWrite, toolName: "Edit" })).toBe(true);
    expect(isPreapprovedWorkflowDraftWrite({ ...draftWrite, toolName: "Write" })).toBe(true);
  });

  it("covers no other tool, including the patch tool that shares the edit permission", () => {
    for (const toolName of ["ApplyPatch", "Bash", "Read", "NotebookEdit"]) {
      expect(isPreapprovedWorkflowDraftWrite({ ...draftWrite, toolName }), toolName).toBe(false);
    }
  });

  it("needs a working directory in the context", () => {
    expect(
      isPreapprovedWorkflowDraftWrite({
        ...draftWrite,
        toolName: "Edit",
        workingDirectory: undefined,
      }),
    ).toBe(false);
  });

  it("needs a string file_path in the input", () => {
    for (const input of [undefined, null, "a string input", {}, { file_path: 42 }]) {
      expect(
        isPreapprovedWorkflowDraftWrite({ ...draftWrite, input, toolName: "Edit" }),
        JSON.stringify(input) ?? "undefined",
      ).toBe(false);
    }
  });
});
