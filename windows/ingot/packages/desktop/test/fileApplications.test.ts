import { afterEach, describe, expect, it, vi } from "vitest";

const { accessMock, statMock, readdirMock, execFileMock } = vi.hoisted(() => ({
  accessMock: vi.fn(),
  statMock: vi.fn(),
  readdirMock: vi.fn(),
  execFileMock: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({ access: accessMock, stat: statMock, readdir: readdirMock }));
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

import {
  getFileApplicationDefs,
  matchesFileApplication,
  resolveFileApplicationPath,
} from "../src/main/fileApplications.js";

afterEach(() => vi.resetAllMocks());

describe("file applications", () => {
  it.each([
    ["pdf", ["preview", "adobe-acrobat", "adobe-reader", "pdf-expert", "wps"]],
    ["docx", ["word", "pages", "wps", "libreoffice-writer"]],
    ["pptx", ["powerpoint", "keynote", "wps", "libreoffice-impress"]],
    ["xlsx", ["excel", "numbers", "wps", "libreoffice-calc"]],
    ["mp3", ["music", "quicktime", "iina", "vlc"]],
    ["mp4", ["quicktime", "iina", "vlc"]],
  ])("macOS %s only returns matching candidates", (extension, expected) => {
    const ids = getFileApplicationDefs("darwin")
      .filter((def) => matchesFileApplication(def, `/work/Output File.${extension.toUpperCase()}`))
      .map((def) => def.id);
    expect(ids).toEqual(expected);
  });
  it("Do not add application if path is missing or type is unknown", () => {
    for (const path of [undefined, "/work/a.ts", "/work/pdf", "/work/file.pdf/folder"]) {
      expect(
        getFileApplicationDefs("darwin").filter((def) => matchesFileApplication(def, path)),
      ).toEqual([]);
    }
  });
  it("Windows 和 Linux 格式映射独立，文件夹菜单不受影响", () => {
    expect(
      getFileApplicationDefs("win32")
        .filter((def) => matchesFileApplication(def, "C:\\Output\\a.pdf"))
        .map((def) => def.id),
    ).toEqual(["adobe-acrobat", "adobe-reader", "foxit", "wps", "edge"]);
    expect(
      getFileApplicationDefs("linux")
        .filter((def) => matchesFileApplication(def, "/tmp/a.mp4"))
        .map((def) => def.id),
    ).toEqual(["vlc", "mpv"]);
  });
  it("Do not return path for uninstalled applications", async () => {
    accessMock.mockRejectedValue(new Error("ENOENT"));
    const def = getFileApplicationDefs("darwin").find((def) => def.id === "pages")!;
    expect(await resolveFileApplicationPath(def, "darwin")).toBeNull();
  });
  it("Support applications installed under user Applications", async () => {
    const def = getFileApplicationDefs("darwin").find((def) => def.id === "pages")!;
    accessMock.mockImplementation(async (path: string) => {
      if (!path.endsWith("/Applications/Pages.app") || path === "/Applications/Pages.app")
        throw new Error("ENOENT");
    });
    expect(await resolveFileApplicationPath(def, "darwin")).toMatch(/\/Applications\/Pages.app$/);
  });
  it("Linux finds executable from PATH", async () => {
    accessMock.mockImplementation(async (path: string) => {
      if (path !== "/usr/bin/vlc") throw new Error("ENOENT");
    });
    const def = getFileApplicationDefs("linux").find((def) => def.id === "vlc")!;
    expect(await resolveFileApplicationPath(def, "linux", "/missing:/usr/bin")).toBe(
      "/usr/bin/vlc",
    );
  });
  it("Windows finds Word in non-standard locations from App Paths", async () => {
    accessMock.mockRejectedValue(new Error("ENOENT"));
    statMock.mockResolvedValue({ isFile: () => true });
    execFileMock.mockImplementation((_file, _args, _options, callback) =>
      callback(null, '    (Default)    REG_SZ    "D:\\Office Suite\\WINWORD.EXE"\r\n'),
    );
    const def = getFileApplicationDefs("win32").find((def) => def.id === "word")!;
    expect(await resolveFileApplicationPath(def, "win32")).toBe("D:\\Office Suite\\WINWORD.EXE");
  });
  it("Windows 支持 WPS 的版本化安装目录", async () => {
    const root = "C:\\Programs\\WPS Office";
    const executable = `${root}\\12.1\\office6\\ksolaunch.exe`;
    accessMock.mockImplementation(async (path) => {
      if (path !== executable) throw new Error("ENOENT");
    });
    execFileMock.mockImplementation((_file, _args, _options, callback) =>
      callback(new Error("not registered"), ""),
    );
    readdirMock.mockResolvedValue([{ name: "12.1", isDirectory: () => true }]);
    const def = getFileApplicationDefs("win32").find((def) => def.id === "wps")!;
    expect(await resolveFileApplicationPath({ ...def, windowsVersionRoots: [root] }, "win32")).toBe(
      executable,
    );
  });
});
