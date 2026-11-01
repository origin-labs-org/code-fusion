import { describe, expect, it } from "vitest";
import { getContainingDirectoryPath, toFileUrl } from "@/lib/path.js";
import { getModelTrajectorySourceDirectory } from "@/ModelTrajectoryPane.js";

describe("path helpers", () => {
  it("Resolve directories for POSIX and Windows files", () => {
    expect(getContainingDirectoryPath("/Users/dev/.cf/cli/debug/model-io.jsonl")).toBe(
      "/Users/dev/.cf/cli/debug",
    );
    expect(getContainingDirectoryPath("C:\\Users\\dev\\.cf\\cli\\debug\\model-io.jsonl")).toBe(
      "C:\\Users\\dev\\.cf\\cli\\debug",
    );
    expect(getContainingDirectoryPath("C:\\model-io.jsonl")).toBe("C:\\");
    expect(getContainingDirectoryPath("/model-io.jsonl")).toBe("/");
  });

  it("Call trace source file directory skips empty paths and falls back to the first valid source file", () => {
    expect(
      getModelTrajectorySourceDirectory([" ", "/Users/dev/.cf/cli/rollout/model-io.jsonl"]),
    ).toBe("/Users/dev/.cf/cli/rollout");
    expect(getModelTrajectorySourceDirectory(["model-io.jsonl"])).toBeNull();
    expect(getModelTrajectorySourceDirectory(undefined)).toBeNull();
  });

  describe("toFileUrl", () => {
    it("Windows drive letter + Chinese + space paths are fully encoded and can be restored via URL parsing", () => {
      const url = toFileUrl("E:\\web\\Report v2.html");
      expect(url).toBe("file:///E:/web/%E6%8A%A5%E5%91%8A%20v2.html");
      expect(new URL(url).pathname).toBe("/E:/web/%E6%8A%A5%E5%91%8A%20v2.html");
    });

    it("Escape # in filenames to %23 so pathname is not truncated by fragment", () => {
      const url = toFileUrl("E:\\web\\index#anchor.html");
      expect(url).toBe("file:///E:/web/index%23anchor.html");
      expect(new URL(url).hash).toBe("");
      expect(new URL(url).pathname).toBe("/E:/web/index%23anchor.html");
    });

    it("POSIX paths containing #, ?, or spaces are also fully escaped", () => {
      const url = toFileUrl("/tmp/what? q#1.html");
      expect(url).toBe("file:///tmp/what%3F%20q%231.html");
      expect(new URL(url).pathname).toBe("/tmp/what%3F%20q%231.html");
      expect(new URL(url).search).toBe("");
      expect(new URL(url).hash).toBe("");
    });

    it("Literal % characters are encoded without producing malformed percent-encoding", () => {
      const url = toFileUrl("E:\\web\\50%.html");
      expect(url).toBe("file:///E:/web/50%25.html");
      expect(new URL(url).pathname).toBe("/E:/web/50%25.html");
    });

    it("Pure ASCII POSIX paths keep existing output unchanged", () => {
      expect(toFileUrl("/tmp/plain.html")).toBe("file:///tmp/plain.html");
    });
  });
});
