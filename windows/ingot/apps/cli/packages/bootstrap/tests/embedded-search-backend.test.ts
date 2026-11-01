import { describe, expect, it } from "vitest";
import { resolveDefaultEmbeddedSearchBackend } from "../src/app/embedded-search-backend.js";

describe("resolveDefaultEmbeddedSearchBackend", () => {
  it("uses bundled bfs, ugrep, and ripgrep paths by default", () => {
    expect(
      resolveDefaultEmbeddedSearchBackend({
        env: {
          CF_BFS_BINARY: "/opt/cf/tools/bfs/bfs",
          CF_RG_BINARY: "/opt/cf/tools/ripgrep/rg",
          CF_UGREP_BINARY: "/opt/cf/tools/ugrep/ugrep",
        },
      }),
    ).toEqual({
      kind: "native-binaries",
      findCommand: "/opt/cf/tools/bfs/bfs",
      grepCommand: "/opt/cf/tools/ugrep/ugrep",
      rgCommand: "/opt/cf/tools/ripgrep/rg",
    });
  });

  it("falls back to bfs, ugrep, and rg command names when bundled paths are unavailable", () => {
    expect(resolveDefaultEmbeddedSearchBackend({ env: {} })).toEqual({
      kind: "native-binaries",
      findCommand: "bfs",
      grepCommand: "ugrep",
      rgCommand: "rg",
    });
  });

  it("preserves the explicit internal CLI compatibility override", () => {
    expect(
      resolveDefaultEmbeddedSearchBackend({
        env: { CF_EMBEDDED_SEARCH_COMMAND: "/tmp/cf-test" },
      }),
    ).toEqual({
      kind: "internal-cli",
      command: "/tmp/cf-test",
      args: ["__internal-search"],
    });
  });
});
