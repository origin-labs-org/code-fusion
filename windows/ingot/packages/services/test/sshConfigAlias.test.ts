import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalHome = process.env["HOME"];
const originalPath = process.env["PATH"];

const tempDirs: string[] = [];

beforeEach(() => {
  vi.resetModules();
});

afterEach(async () => {
  if (originalHome == null) {
    delete process.env["HOME"];
  } else {
    process.env["HOME"] = originalHome;
  }

  if (originalPath == null) {
    delete process.env["PATH"];
  } else {
    process.env["PATH"] = originalPath;
  }

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function createTempHome(): Promise<string> {
  const homeDir = await mkdtemp(join(tmpdir(), "cf-ssh-alias-test-"));
  tempDirs.push(homeDir);
  await mkdir(join(homeDir, ".ssh"), { recursive: true });
  return homeDir;
}

async function createFakeSshExecutable(homeDir: string, lines: string[]): Promise<string> {
  const binDir = join(homeDir, "bin");
  await mkdir(binDir, { recursive: true });
  const sshPath = join(binDir, "ssh");
  const output = lines.join("\n");
  await writeFile(
    sshPath,
    ["#!/bin/sh", "cat <<'EOF'", output, "EOF", "exit 0", ""].join("\n"),
    "utf8",
  );
  await chmod(sshPath, 0o755);
  return binDir;
}

async function loadAliasParser() {
  const { listSSHConfigAliasesFromLocalConfig } = await import("@origin-ai/cf-services/node");
  return listSSHConfigAliasesFromLocalConfig;
}

describe("sshConfigAlias fallback parser", () => {
  const testTimeout = 15000;

  it(
    "Reads a single alias and maps it to connection form fields",
    async () => {
      const homeDir = await createTempHome();
      process.env["HOME"] = homeDir;
      process.env["PATH"] = "";

      const configPath = join(homeDir, ".ssh", "config");
      await writeFile(
        configPath,
        [
          "Host dev",
          "  HostName dev.internal",
          "  User root",
          "  Port 2222",
          "  IdentityFile ~/.ssh/id_ed25519",
          "",
        ].join("\n"),
        "utf8",
      );

      const listSSHConfigAliasesFromLocalConfig = await loadAliasParser();
      const aliases = await listSSHConfigAliasesFromLocalConfig();

      expect(aliases).toHaveLength(1);
      expect(aliases[0]).toMatchObject({
        alias: "dev",
        host: "dev.internal",
        username: "root",
        port: 2222,
        source: configPath,
      });
      expect(aliases[0]?.privateKeyPath).toBe(join(homeDir, ".ssh", "id_ed25519"));
    },
    testTimeout,
  );

  it(
    "Supports Include and filters out patterns that cannot be directly connected",
    async () => {
      const homeDir = await createTempHome();
      process.env["HOME"] = homeDir;
      process.env["PATH"] = "";

      const includeDir = join(homeDir, ".ssh", "includes");
      await mkdir(includeDir, { recursive: true });
      await writeFile(
        join(includeDir, "aliases.conf"),
        [
          "Host dev",
          "  HostName dev.example.com",
          "  Port 2201",
          "Host multi one",
          "  HostName invalid.example.com",
          "",
        ].join("\n"),
        "utf8",
      );

      await writeFile(
        join(homeDir, ".ssh", "config"),
        [
          "Include includes/*.conf",
          "Host *",
          "  User default-user",
          "Host skip-*",
          "  HostName wildcard.example.com",
          "Host prod",
          "  HostName prod.example.com",
          "",
        ].join("\n"),
        "utf8",
      );

      const listSSHConfigAliasesFromLocalConfig = await loadAliasParser();
      const aliases = await listSSHConfigAliasesFromLocalConfig();
      const aliasNames = aliases.map((item) => item.alias);

      expect(aliasNames).toEqual(["dev", "prod"]);
      expect(aliases[0]).toMatchObject({
        alias: "dev",
        host: "dev.example.com",
        port: 2201,
        username: "default-user",
        source: join(includeDir, "aliases.conf"),
      });
      expect(aliases[1]).toMatchObject({
        alias: "prod",
        host: "prod.example.com",
        username: "default-user",
        source: join(homeDir, ".ssh", "config"),
      });
    },
    testTimeout,
  );

  it(
    "Teleport wildcard Host blocks do not block normal alias enumeration",
    async () => {
      const homeDir = await createTempHome();
      process.env["HOME"] = homeDir;
      process.env["PATH"] = "";

      const configPath = join(homeDir, ".ssh", "config");
      await writeFile(
        configPath,
        [
          "Host *.teleport-*.example.com",
          "  User root",
          "  UserKnownHostsFile /dev/null",
          "",
          "Host *.teleport-bj03.example.com !teleport.example.net",
          "  Port 3022",
          "  ProxyCommand /usr/local/bin/tsh proxy ssh --cluster=teleport-bj03.example.com %r@%h:%p",
          "",
          "Host jump-120",
          "  HostName 172.16.0.11",
          "  User root",
          "",
          "Host ncu",
          "  HostName 10.0.0.103",
          "  User root",
          "  ProxyJump jump-120",
          "",
        ].join("\n"),
        "utf8",
      );

      const listSSHConfigAliasesFromLocalConfig = await loadAliasParser();
      const aliases = await listSSHConfigAliasesFromLocalConfig();

      expect(aliases.map((item) => item.alias)).toEqual(["jump-120", "ncu"]);
      expect(aliases[1]).toMatchObject({
        alias: "ncu",
        host: "10.0.0.103",
        username: "root",
        source: configPath,
      });
    },
    testTimeout,
  );

  if (process.platform === "win32") {
    return;
  }

  it("Does not misidentify as key-based login when ssh -G only returns default identityfile", async () => {
    const homeDir = await createTempHome();
    process.env["HOME"] = homeDir;

    const configPath = join(homeDir, ".ssh", "config");
    await writeFile(
      configPath,
      [
        "Host password-host",
        "  HostName password.example.com",
        "  User root",
        "  Port 22",
        "",
      ].join("\n"),
      "utf8",
    );

    const fakeSshPath = await createFakeSshExecutable(homeDir, [
      "hostname password.example.com",
      "port 22",
      "user root",
      "identityfile ~/.ssh/id_rsa",
    ]);
    process.env["PATH"] = fakeSshPath;

    const listSSHConfigAliasesFromLocalConfig = await loadAliasParser();
    const aliases = await listSSHConfigAliasesFromLocalConfig();

    expect(aliases).toHaveLength(1);
    expect(aliases[0]).toMatchObject({
      alias: "password-host",
      host: "password.example.com",
      username: "root",
      port: 22,
      source: configPath,
    });
    expect(aliases[0]?.privateKeyPath).toBeUndefined();
  });

  it(
    "Preserves backslashes in Windows-style private key paths",
    async () => {
      const homeDir = await createTempHome();
      process.env["HOME"] = homeDir;
      process.env["PATH"] = "";

      const configPath = join(homeDir, ".ssh", "config");
      const windowsPrivateKeyPath = "C:\\Users\\alice\\.ssh\\id_ed25519";
      await writeFile(
        configPath,
        [
          "Host windows-host",
          "  HostName windows.example.com",
          "  User root",
          `  IdentityFile ${windowsPrivateKeyPath}`,
          "",
        ].join("\n"),
        "utf8",
      );

      const listSSHConfigAliasesFromLocalConfig = await loadAliasParser();
      const aliases = await listSSHConfigAliasesFromLocalConfig();

      expect(aliases).toHaveLength(1);
      expect(aliases[0]).toMatchObject({
        alias: "windows-host",
        host: "windows.example.com",
        username: "root",
        source: configPath,
      });
      expect(aliases[0]?.privateKeyPath).toBe(windowsPrivateKeyPath);
    },
    testTimeout,
  );

  it(
    "Supports direct Include paths containing backslashes",
    async () => {
      const homeDir = await createTempHome();
      process.env["HOME"] = homeDir;
      process.env["PATH"] = "";

      const includeToken = "includes\\alias.conf";
      const includeFilePath = join(homeDir, ".ssh", includeToken);
      if (process.platform === "win32") {
        await mkdir(join(homeDir, ".ssh", "includes"), { recursive: true });
      }
      await writeFile(
        includeFilePath,
        [
          "Host backslash-include",
          "  HostName include.example.com",
          "  User include-user",
          "",
        ].join("\n"),
        "utf8",
      );

      const rootConfigPath = join(homeDir, ".ssh", "config");
      await writeFile(rootConfigPath, [`Include ${includeToken}`, ""].join("\n"), "utf8");

      const listSSHConfigAliasesFromLocalConfig = await loadAliasParser();
      const aliases = await listSSHConfigAliasesFromLocalConfig();

      expect(aliases).toHaveLength(1);
      expect(aliases[0]).toMatchObject({
        alias: "backslash-include",
        host: "include.example.com",
        username: "include-user",
        source: includeFilePath,
      });
    },
    testTimeout,
  );
});
