import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

type CommandCall = { command: string; args: string[] };

function readPngSize(path: string): { width: number; height: number } {
  const png = readFileSync(path);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

describe("desktop Linux deep link registration helpers", () => {
  it("prefers the AppImage path for protocol desktop entry Exec", async () => {
    const { createLinuxDeepLinkDesktopEntry, resolveLinuxDeepLinkCommand } =
      await import("../src/main/desktopLinuxDeepLinkRegistration.js");

    const command = resolveLinuxDeepLinkCommand({
      env: { APPIMAGE: "/home/alice/Downloads/CodeFusion-2.8.0-linux-x64.AppImage" },
      executablePath: "/tmp/.mount_Cf/cf",
    });
    const entry = createLinuxDeepLinkDesktopEntry(command);

    expect(command.executablePath).toBe("/home/alice/Downloads/CodeFusion-2.8.0-linux-x64.AppImage");
    expect(entry).toContain('Exec="/home/alice/Downloads/CodeFusion-2.8.0-linux-x64.AppImage" %U');
    expect(entry).toContain("MimeType=x-scheme-handler/cf;");
  });

  it("keeps AppImage sandbox and GPU launch switches for protocol callbacks", async () => {
    const { createLinuxDeepLinkDesktopEntry, resolveLinuxDeepLinkCommand } =
      await import("../src/main/desktopLinuxDeepLinkRegistration.js");

    const command = resolveLinuxDeepLinkCommand({
      env: { APPIMAGE: "/home/alice/Applications/CodeFusion.AppImage" },
      executablePath: "/tmp/.mount_Cf/cf",
      argv: [
        "/tmp/.mount_Cf/cf",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--use-gl=swiftshader",
        "--remote-debugging-port=9229",
        "cf://oauth/callback?code=1&state=s",
        "/home/alice/project",
      ],
    });
    const entry = createLinuxDeepLinkDesktopEntry(command);

    expect(command.args).toEqual([
      "--no-sandbox",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--use-gl=swiftshader",
    ]);
    expect(entry).toContain(
      'Exec="/home/alice/Applications/CodeFusion.AppImage" "--no-sandbox" "--disable-gpu" "--disable-software-rasterizer" "--use-gl=swiftshader" %U',
    );
    expect(entry).not.toContain("remote-debugging-port");
    expect(entry).not.toContain("oauth/callback");
    expect(entry).not.toContain("/home/alice/project");
  });

  it("does not persist launch switches for non-AppImage Linux installs", async () => {
    const { createLinuxDeepLinkDesktopEntry, resolveLinuxDeepLinkCommand } =
      await import("../src/main/desktopLinuxDeepLinkRegistration.js");

    const command = resolveLinuxDeepLinkCommand({
      env: {},
      executablePath: "/opt/CodeFusion/cf",
      argv: ["/opt/CodeFusion/cf", "--no-sandbox", "--disable-gpu"],
    });
    const entry = createLinuxDeepLinkDesktopEntry(command);

    expect(command).toEqual({ executablePath: "/opt/CodeFusion/cf", args: [] });
    expect(entry).toContain('Exec="/opt/CodeFusion/cf" %U');
  });

  it("escapes desktop Exec paths before writing user-level handlers", async () => {
    const { createLinuxDeepLinkDesktopEntry } =
      await import("../src/main/desktopLinuxDeepLinkRegistration.js");

    const entry = createLinuxDeepLinkDesktopEntry({
      executablePath: '/home/alice/Downloads/CodeFusion "Nightly".AppImage',
    });

    expect(entry).toContain('Exec="/home/alice/Downloads/CodeFusion \\"Nightly\\".AppImage" %U');
  });

  it("writes the Preview product name into the shared Linux protocol handler", async () => {
    const { createLinuxDeepLinkDesktopEntry } =
      await import("../src/main/desktopLinuxDeepLinkRegistration.js");

    const entry = createLinuxDeepLinkDesktopEntry({
      executablePath: "/opt/CodeFusion Preview/cf-preview",
      productName: "CodeFusion Preview",
    });

    expect(entry).toContain("Name=CodeFusion Preview");
    expect(entry).toContain("StartupWMClass=CodeFusion Preview");
    expect(entry).toContain('Exec="/opt/CodeFusion Preview/cf-preview" %U');
    expect(entry).toContain("MimeType=x-scheme-handler/cf;");
  });

  it("escapes AppImage callback switches before writing desktop Exec", async () => {
    const { createLinuxDeepLinkDesktopEntry } =
      await import("../src/main/desktopLinuxDeepLinkRegistration.js");

    const entry = createLinuxDeepLinkDesktopEntry({
      executablePath: "/home/alice/Downloads/CodeFusion.AppImage",
      args: ['--disable-features=UseOzonePlatform,"Quoted"'],
    });

    expect(entry).toContain(
      'Exec="/home/alice/Downloads/CodeFusion.AppImage" "--disable-features=UseOzonePlatform,\\"Quoted\\"" %U',
    );
  });

  it("installs a user-level hicolor icon only for AppImage launches", async () => {
    const { resolveLinuxUserDataDir } =
      await import("../src/main/desktopLinuxDeepLinkRegistration.js");
    const { installLinuxAppImageDesktopIcon, shouldInstallAppImageDesktopIcon } =
      await import("../src/main/desktopLinuxAppImageIcon.js");
    const tempRoot = mkdtempSync(join(tmpdir(), "cf-linux-icon-"));
    const iconSourcePath = join(import.meta.dirname, "..", "build", "icons", "512x512.png");
    const homeDir = join(tempRoot, "home");
    const dataDir = resolveLinuxUserDataDir({ homeDir });
    const commandCalls: CommandCall[] = [];

    try {
      expect(readPngSize(iconSourcePath)).toEqual({ width: 512, height: 512 });

      expect(
        shouldInstallAppImageDesktopIcon({
          env: { APPIMAGE: "/home/alice/Applications/CodeFusion.AppImage" },
          iconSourcePath,
        }),
      ).toBe(true);
      expect(shouldInstallAppImageDesktopIcon({ env: {}, iconSourcePath })).toBe(false);

      const result = installLinuxAppImageDesktopIcon({
        dataDir,
        iconSourcePath,
        logger: { info: () => undefined, warn: () => undefined },
        runCommand: (command, args) => {
          commandCalls.push({ command, args });
          return { status: 0, stderr: "" };
        },
      });

      expect(result).toEqual({
        iconFilePath: join(dataDir, "icons", "hicolor", "512x512", "apps", "cf.png"),
        installed: true,
        changed: true,
      });
      expect(existsSync(result.iconFilePath)).toBe(true);
      expect(readPngSize(result.iconFilePath)).toEqual({ width: 512, height: 512 });
      expect(commandCalls).toEqual([
        {
          command: "gtk-update-icon-cache",
          args: ["-f", "-t", join(dataDir, "icons", "hicolor")],
        },
      ]);
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it("uses XDG_DATA_HOME for user-level desktop entries and icons", async () => {
    const { resolveLinuxUserDataDir } =
      await import("../src/main/desktopLinuxDeepLinkRegistration.js");

    expect(
      resolveLinuxUserDataDir({
        env: { XDG_DATA_HOME: "/tmp/xdg-data" },
        homeDir: "/home/alice",
      }),
    ).toBe("/tmp/xdg-data");
    expect(resolveLinuxUserDataDir({ env: { XDG_DATA_HOME: " " }, homeDir: "/home/alice" })).toBe(
      join("/home/alice", ".local", "share"),
    );
  });

  it("keeps desktop entry registration when optional AppImage icon install fails", async () => {
    const { registerLinuxDeepLinkProtocol } =
      await import("../src/main/desktopLinuxDeepLinkRegistration.js");
    const tempRoot = mkdtempSync(join(tmpdir(), "cf-linux-registration-"));
    const homeDir = join(tempRoot, "home");
    const badIconSourcePath = join(tempRoot, "icon-source-directory");
    const warnings: unknown[][] = [];
    const commandCalls: CommandCall[] = [];

    try {
      mkdirSync(badIconSourcePath, { recursive: true });
      registerLinuxDeepLinkProtocol({
        executablePath: "/tmp/.mount_Cf/cf",
        homeDir,
        iconSourcePath: badIconSourcePath,
        env: { APPIMAGE: "/home/alice/Applications/CodeFusion.AppImage" },
        systemApplicationDirs: [join(tempRoot, "empty-system-applications")],
        logger: {
          info: () => undefined,
          warn: (...args: unknown[]) => warnings.push(args),
        },
        runCommand: (command, args) => {
          commandCalls.push({ command, args });
          return { status: 0, stderr: "" };
        },
      });

      const desktopFilePath = join(homeDir, ".local", "share", "applications", "cf.desktop");
      expect(existsSync(desktopFilePath)).toBe(true);
      expect(readFileSync(desktopFilePath, "utf8")).toContain(
        'Exec="/home/alice/Applications/CodeFusion.AppImage" %U',
      );
      expect(
        warnings.some(([message]) => message === "[deep-link] Linux AppImage icon installation failed; degraded"),
      ).toBe(true);
      expect(commandCalls).toEqual([
        {
          command: "update-desktop-database",
          args: [join(homeDir, ".local", "share", "applications")],
        },
        {
          command: "xdg-mime",
          args: ["default", "cf.desktop", "x-scheme-handler/cf"],
        },
      ]);
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it("resolves system application dirs from XDG_DATA_DIRS with spec defaults", async () => {
    const { resolveLinuxSystemApplicationDirs } =
      await import("../src/main/desktopLinuxDeepLinkRegistration.js");

    expect(
      resolveLinuxSystemApplicationDirs({
        XDG_DATA_DIRS: " /opt/custom/share :/usr/share: ",
      }),
    ).toEqual([join("/opt/custom/share", "applications"), join("/usr/share", "applications")]);
    expect(resolveLinuxSystemApplicationDirs({ XDG_DATA_DIRS: "::" })).toEqual([
      join("/usr/local/share", "applications"),
      join("/usr/share", "applications"),
    ]);
    expect(resolveLinuxSystemApplicationDirs()).toEqual([
      join("/usr/local/share", "applications"),
      join("/usr/share", "applications"),
    ]);
  });

  it("removes the stale owned user-level entry when a system-level entry exists", async () => {
    const { registerLinuxDeepLinkProtocol } =
      await import("../src/main/desktopLinuxDeepLinkRegistration.js");
    const tempRoot = mkdtempSync(join(tmpdir(), "cf-linux-system-entry-"));
    const homeDir = join(tempRoot, "home");
    const systemApplicationsDir = join(tempRoot, "system", "applications");
    const desktopFilePath = join(homeDir, ".local", "share", "applications", "cf.desktop");
    const infos: unknown[][] = [];
    const commandCalls: CommandCall[] = [];

    try {
      mkdirSync(systemApplicationsDir, { recursive: true });
      writeFileSync(
        join(systemApplicationsDir, "cf.desktop"),
        "[Desktop Entry]\nName=CodeFusion\nExec=/opt/CodeFusion/cf %U\n",
        "utf8",
      );
      mkdirSync(dirname(desktopFilePath), { recursive: true });
      writeFileSync(
        desktopFilePath,
        [
          "[Desktop Entry]",
          "Name=CodeFusion",
          "Comment=CodeFusion Desktop App",
          'Exec="/home/alice/Downloads/CodeFusion-2.8.0-linux-x64.AppImage" %U',
          "MimeType=x-scheme-handler/cf;",
          "",
        ].join("\n"),
        "utf8",
      );

      registerLinuxDeepLinkProtocol({
        executablePath: "/opt/CodeFusion/cf",
        homeDir,
        env: {},
        systemApplicationDirs: [systemApplicationsDir],
        logger: {
          info: (...args: unknown[]) => infos.push(args),
          warn: () => undefined,
        },
        runCommand: (command, args) => {
          commandCalls.push({ command, args });
          return { status: 0, stderr: "" };
        },
      });

      expect(existsSync(desktopFilePath)).toBe(false);
      expect(commandCalls).toEqual([
        {
          command: "update-desktop-database",
          args: [join(homeDir, ".local", "share", "applications")],
        },
        {
          command: "xdg-mime",
          args: ["default", "cf.desktop", "x-scheme-handler/cf"],
        },
      ]);
      expect(
        infos.some(([message]) => message === "[deep-link] Linux 系统级 desktop entry 已存在"),
      ).toBe(true);
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it("keeps a custom user-level entry untouched when a system-level entry exists", async () => {
    const { registerLinuxDeepLinkProtocol } =
      await import("../src/main/desktopLinuxDeepLinkRegistration.js");
    const tempRoot = mkdtempSync(join(tmpdir(), "cf-linux-custom-entry-"));
    const homeDir = join(tempRoot, "home");
    const systemApplicationsDir = join(tempRoot, "system", "applications");
    const desktopFilePath = join(homeDir, ".local", "share", "applications", "cf.desktop");
    const warnings: unknown[][] = [];

    try {
      mkdirSync(systemApplicationsDir, { recursive: true });
      writeFileSync(
        join(systemApplicationsDir, "cf.desktop"),
        "[Desktop Entry]\nName=CodeFusion\nExec=/opt/CodeFusion/cf %U\n",
        "utf8",
      );
      mkdirSync(dirname(desktopFilePath), { recursive: true });
      const customEntry =
        "[Desktop Entry]\nName=CodeFusion\nComment=Custom wrapper\nExec=/home/alice/wrap.sh %U\n";
      writeFileSync(desktopFilePath, customEntry, "utf8");

      registerLinuxDeepLinkProtocol({
        executablePath: "/opt/CodeFusion/cf",
        homeDir,
        env: {},
        systemApplicationDirs: [systemApplicationsDir],
        logger: {
          info: () => undefined,
          warn: (...args: unknown[]) => warnings.push(args),
        },
        runCommand: () => ({ status: 0, stderr: "" }),
      });

      expect(existsSync(desktopFilePath)).toBe(true);
      expect(readFileSync(desktopFilePath, "utf8")).toBe(customEntry);
      expect(
        warnings.some(
          ([message]) =>
            message === "[deep-link] Linux user-level cf.desktop was not written by this application; keeping without cleanup",
        ),
      ).toBe(true);
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it("does not shadow a system-level entry for AppImage launches", async () => {
    const { registerLinuxDeepLinkProtocol } =
      await import("../src/main/desktopLinuxDeepLinkRegistration.js");
    const tempRoot = mkdtempSync(join(tmpdir(), "cf-linux-appimage-system-"));
    const homeDir = join(tempRoot, "home");
    const systemApplicationsDir = join(tempRoot, "system", "applications");
    const desktopFilePath = join(homeDir, ".local", "share", "applications", "cf.desktop");
    const iconSourcePath = join(import.meta.dirname, "..", "build", "icons", "512x512.png");
    const commandCalls: CommandCall[] = [];

    try {
      mkdirSync(systemApplicationsDir, { recursive: true });
      writeFileSync(
        join(systemApplicationsDir, "cf.desktop"),
        "[Desktop Entry]\nName=CodeFusion\nExec=/opt/CodeFusion/cf %U\n",
        "utf8",
      );

      registerLinuxDeepLinkProtocol({
        executablePath: "/tmp/.mount_Cf/cf",
        homeDir,
        iconSourcePath,
        env: { APPIMAGE: "/home/alice/Applications/CodeFusion.AppImage" },
        systemApplicationDirs: [systemApplicationsDir],
        logger: { info: () => undefined, warn: () => undefined },
        runCommand: (command, args) => {
          commandCalls.push({ command, args });
          return { status: 0, stderr: "" };
        },
      });

      expect(existsSync(desktopFilePath)).toBe(false);
      expect(
        existsSync(
          join(homeDir, ".local", "share", "icons", "hicolor", "512x512", "apps", "cf.png"),
        ),
      ).toBe(false);
      expect(commandCalls).toEqual([
        {
          command: "update-desktop-database",
          args: [join(homeDir, ".local", "share", "applications")],
        },
        {
          command: "xdg-mime",
          args: ["default", "cf.desktop", "x-scheme-handler/cf"],
        },
      ]);
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it("still writes the user-level entry when no system-level entry exists", async () => {
    const { registerLinuxDeepLinkProtocol } =
      await import("../src/main/desktopLinuxDeepLinkRegistration.js");
    const tempRoot = mkdtempSync(join(tmpdir(), "cf-linux-no-system-"));
    const homeDir = join(tempRoot, "home");
    const desktopFilePath = join(homeDir, ".local", "share", "applications", "cf.desktop");

    try {
      registerLinuxDeepLinkProtocol({
        executablePath: "/opt/CodeFusion/cf",
        homeDir,
        env: {},
        systemApplicationDirs: [join(tempRoot, "empty-system-applications")],
        logger: { info: () => undefined, warn: () => undefined },
        runCommand: () => ({ status: 0, stderr: "" }),
      });

      expect(existsSync(desktopFilePath)).toBe(true);
      expect(readFileSync(desktopFilePath, "utf8")).toContain('Exec="/opt/CodeFusion/cf" %U');
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it("ignores non-regular system-level paths when probing for shadow entries", async () => {
    const { registerLinuxDeepLinkProtocol } =
      await import("../src/main/desktopLinuxDeepLinkRegistration.js");
    const tempRoot = mkdtempSync(join(tmpdir(), "cf-linux-dir-system-"));
    const homeDir = join(tempRoot, "home");
    const systemApplicationsDir = join(tempRoot, "system", "applications");
    const desktopFilePath = join(homeDir, ".local", "share", "applications", "cf.desktop");

    try {
      mkdirSync(join(systemApplicationsDir, "cf.desktop"), { recursive: true });
      registerLinuxDeepLinkProtocol({
        executablePath: "/opt/CodeFusion/cf",
        homeDir,
        env: {},
        systemApplicationDirs: [systemApplicationsDir],
        logger: { info: () => undefined, warn: () => undefined },
        runCommand: () => ({ status: 0, stderr: "" }),
      });

      expect(existsSync(desktopFilePath)).toBe(true);
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it("keeps an unreadable user-level entry and continues protocol registration", async () => {
    const { registerLinuxDeepLinkProtocol } =
      await import("../src/main/desktopLinuxDeepLinkRegistration.js");
    const tempRoot = mkdtempSync(join(tmpdir(), "cf-linux-unreadable-"));
    const homeDir = join(tempRoot, "home");
    const systemApplicationsDir = join(tempRoot, "system", "applications");
    const desktopFilePath = join(homeDir, ".local", "share", "applications", "cf.desktop");
    const warnings: unknown[][] = [];
    const commandCalls: CommandCall[] = [];

    try {
      mkdirSync(systemApplicationsDir, { recursive: true });
      writeFileSync(
        join(systemApplicationsDir, "cf.desktop"),
        "[Desktop Entry]\nName=CodeFusion\nExec=/opt/CodeFusion/cf %U\n",
        "utf8",
      );
      mkdirSync(dirname(desktopFilePath), { recursive: true });
      writeFileSync(desktopFilePath, "unreadable-placeholder", "utf8");
      chmodSync(desktopFilePath, 0o000);

      registerLinuxDeepLinkProtocol({
        executablePath: "/opt/CodeFusion/cf",
        homeDir,
        env: {},
        systemApplicationDirs: [systemApplicationsDir],
        logger: {
          info: () => undefined,
          warn: (...args: unknown[]) => warnings.push(args),
        },
        runCommand: (command, args) => {
          commandCalls.push({ command, args });
          return { status: 0, stderr: "" };
        },
      });

      expect(existsSync(desktopFilePath)).toBe(true);
      expect(
        warnings.some(
          ([message]) =>
            message === "[deep-link] Linux user-level cf.desktop was not written by this application; keeping without cleanup",
        ),
      ).toBe(true);
      expect(commandCalls).toEqual([
        {
          command: "update-desktop-database",
          args: [join(homeDir, ".local", "share", "applications")],
        },
        {
          command: "xdg-mime",
          args: ["default", "cf.desktop", "x-scheme-handler/cf"],
        },
      ]);
    } finally {
      chmodSync(desktopFilePath, 0o700);
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it("recognizes ownership markers with CRLF line endings", async () => {
    const { registerLinuxDeepLinkProtocol } =
      await import("../src/main/desktopLinuxDeepLinkRegistration.js");
    const tempRoot = mkdtempSync(join(tmpdir(), "cf-linux-crlf-"));
    const homeDir = join(tempRoot, "home");
    const systemApplicationsDir = join(tempRoot, "system", "applications");
    const desktopFilePath = join(homeDir, ".local", "share", "applications", "cf.desktop");
    const infos: unknown[][] = [];

    try {
      mkdirSync(systemApplicationsDir, { recursive: true });
      writeFileSync(
        join(systemApplicationsDir, "cf.desktop"),
        "[Desktop Entry]\nName=CodeFusion\nExec=/opt/CodeFusion/cf %U\n",
        "utf8",
      );
      mkdirSync(dirname(desktopFilePath), { recursive: true });
      writeFileSync(
        desktopFilePath,
        [
          "[Desktop Entry]",
          "Name=CodeFusion",
          "Comment=CodeFusion Desktop App",
          'Exec="/home/alice/Downloads/CodeFusion.AppImage" %U',
          "MimeType=x-scheme-handler/cf;",
          "",
        ].join("\r\n"),
        "utf8",
      );

      registerLinuxDeepLinkProtocol({
        executablePath: "/opt/CodeFusion/cf",
        homeDir,
        env: {},
        systemApplicationDirs: [systemApplicationsDir],
        logger: {
          info: (...args: unknown[]) => infos.push(args),
          warn: () => undefined,
        },
        runCommand: () => ({ status: 0, stderr: "" }),
      });

      expect(existsSync(desktopFilePath)).toBe(false);
      expect(
        infos.some(
          ([message]) => message === "[deep-link] 已清理遗留的用户级 cf.desktop，恢复系统级条目",
        ),
      ).toBe(true);
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "continues protocol registration when removing the stale entry fails",
    async () => {
      const { registerLinuxDeepLinkProtocol } =
        await import("../src/main/desktopLinuxDeepLinkRegistration.js");
      const tempRoot = mkdtempSync(join(tmpdir(), "cf-linux-rm-fail-"));
      const homeDir = join(tempRoot, "home");
      const systemApplicationsDir = join(tempRoot, "system", "applications");
      const applicationsDir = join(homeDir, ".local", "share", "applications");
      const desktopFilePath = join(applicationsDir, "cf.desktop");
      const warnings: unknown[][] = [];
      const commandCalls: CommandCall[] = [];

      try {
        mkdirSync(systemApplicationsDir, { recursive: true });
        writeFileSync(
          join(systemApplicationsDir, "cf.desktop"),
          "[Desktop Entry]\nName=CodeFusion\nExec=/opt/CodeFusion/cf %U\n",
          "utf8",
        );
        mkdirSync(applicationsDir, { recursive: true });
        writeFileSync(
          desktopFilePath,
          '[Desktop Entry]\nComment=CodeFusion Desktop App\nExec="/old/CodeFusion.AppImage" %U\n',
          "utf8",
        );
        chmodSync(applicationsDir, 0o500);

        registerLinuxDeepLinkProtocol({
          executablePath: "/opt/CodeFusion/cf",
          homeDir,
          env: {},
          systemApplicationDirs: [systemApplicationsDir],
          logger: {
            info: () => undefined,
            warn: (...args: unknown[]) => warnings.push(args),
          },
          runCommand: (command, args) => {
            commandCalls.push({ command, args });
            return { status: 0, stderr: "" };
          },
        });

        expect(existsSync(desktopFilePath)).toBe(true);
        expect(
          warnings.some(([message]) => message === "[deep-link] 清理遗留用户级 cf.desktop 失败"),
        ).toBe(true);
        expect(commandCalls).toEqual([
          {
            command: "update-desktop-database",
            args: [applicationsDir],
          },
          {
            command: "xdg-mime",
            args: ["default", "cf.desktop", "x-scheme-handler/cf"],
          },
        ]);
      } finally {
        chmodSync(applicationsDir, 0o700);
        rmSync(tempRoot, { force: true, recursive: true });
      }
    },
  );
});
