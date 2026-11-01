import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCipheriv, pbkdf2Sync } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

const lockedChromeSidecars = vi.hoisted(() => new Set<string>());

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    stat: async (path: Parameters<typeof actual.stat>[0]) =>
      lockedChromeSidecars.has(String(path))
        ? ({} as Awaited<ReturnType<typeof actual.stat>>)
        : actual.stat(path),
    copyFile: async (
      source: Parameters<typeof actual.copyFile>[0],
      destination: Parameters<typeof actual.copyFile>[1],
      mode?: Parameters<typeof actual.copyFile>[2],
    ) => {
      if (lockedChromeSidecars.has(String(source))) {
        throw Object.assign(new Error("Chrome sidecar is locked"), { code: "EBUSY" });
      }
      return actual.copyFile(source, destination, mode);
    },
  };
});

vi.mock("electron", () => ({
  session: {
    fromPartition: vi.fn(),
  },
}));

import {
  clearEmbeddedBrowserData,
  importChromeBrowserData,
  resolveChromeDefaultProfilePath,
} from "../src/main/browserDataManager.js";
import {
  getEmbeddedBrowserSitePermissionSnapshot as snapshotSitePermissions,
  initEmbeddedBrowserSitePermissions,
  resetEmbeddedBrowserSitePermissionsForTest,
  writeEmbeddedBrowserSitePermission,
} from "../src/main/embeddedBrowserSitePermissions.js";
import {
  cleanupChromeHelperTempRoot,
  discoverChromeLocalStorageOrigins,
  importChromeLocalStorage,
} from "../src/main/chromeLocalStorageManager.js";
import { WindowsChromeAppBoundImportError } from "../src/main/windowsChromeAppBoundKey.js";

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
};
const localStorageResult = {
  originsImported: 2,
  entriesImported: 5,
  originsSkipped: 1,
  originsFailed: 0,
};
const localStorageImporter = vi.fn(async () => localStorageResult);

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "cf-browser-data-test-"));
  lockedChromeSidecars.clear();
  vi.clearAllMocks();
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

function createChromeProfile(
  options: { encryptedValue?: Buffer; modernCookiePath?: boolean; value?: string } = {},
): string {
  const profilePath = join(tempRoot, "Default");
  const cookieDatabasePath = options.modernCookiePath
    ? join(profilePath, "Network", "Cookies")
    : join(profilePath, "Cookies");
  const cookieDatabase = new DatabaseSync(cookieDatabasePath);
  cookieDatabase.exec(`
    CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
    INSERT INTO meta (key, value) VALUES ('version', '23');
    CREATE TABLE cookies (
      host_key TEXT NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      expires_utc INTEGER NOT NULL,
      is_secure INTEGER NOT NULL,
      is_httponly INTEGER NOT NULL,
      samesite INTEGER NOT NULL,
      value TEXT NOT NULL,
      encrypted_value BLOB NOT NULL
    );
  `);
  cookieDatabase
    .prepare("INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      "example.com",
      "session",
      "/",
      0n,
      1n,
      1n,
      1n,
      options.value ?? "fixture-value",
      options.encryptedValue ?? Buffer.alloc(0),
    );
  cookieDatabase.close();

  return profilePath;
}

function encryptLinuxV10Cookie(value: string): Buffer {
  const key = pbkdf2Sync("peanuts", "saltysalt", 1, 16, "sha1");
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  return Buffer.concat([Buffer.from("v10"), cipher.update(value), cipher.final()]);
}

function createFailingSourceBackup(): {
  databaseBackup: typeof backup;
  getCallCount: () => number;
} {
  let callCount = 0;
  return {
    databaseBackup: async (sourceDatabase, destination, options) => {
      callCount += 1;
      if (callCount === 1) {
        throw Object.assign(new Error("source WAL lock unavailable"), {
          code: "ERR_SQLITE_ERROR",
        });
      }
      return options
        ? backup(sourceDatabase, destination, options)
        : backup(sourceDatabase, destination);
    },
    getCallCount: () => callCount,
  };
}

function encryptWindowsCookieV20(value: string, key: Buffer): Buffer {
  const nonce = Buffer.alloc(12, 7);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from("v20"), nonce, ciphertext, cipher.getAuthTag()]);
}

describe("browserDataManager", () => {
  it("Do not overwrite read results when Chrome helper temporary directory cleanup fails", async () => {
    const cleanupError = Object.assign(new Error("directory is not empty"), {
      code: "ENOTEMPTY",
    });
    const remover = vi.fn(async () => {
      throw cleanupError;
    });

    await expect(
      cleanupChromeHelperTempRoot({ tempRoot, logger, remover }),
    ).resolves.toBeUndefined();

    expect(remover).toHaveBeenCalledWith(tempRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
    expect(logger.warn).toHaveBeenCalledWith("[browser-data] Chrome helper 临时目录清理失败", {
      name: "Error",
      code: "ENOTEMPTY",
    });
  });

  it("Use createRequire to load node:sqlite to avoid desktop bundle losing node: prefix", async () => {
    const source = await readFile(
      join(import.meta.dirname, "../src/main/chromeCookieManager.ts"),
      "utf8",
    );

    expect(source).toMatch(/nodeRequire\(\s*"node:sqlite",?\s*\)/);
    expect(source).not.toContain('await import("node:sqlite")');
  });

  it("Locate Chrome Default Profile by operating system", () => {
    expect(
      resolveChromeDefaultProfilePath({
        platform: "darwin",
        homeDir: "/Users/demo",
      }),
    ).toBe(join("/Users/demo", "Library", "Application Support", "Google", "Chrome", "Default"));
    expect(
      resolveChromeDefaultProfilePath({
        platform: "win32",
        homeDir: "C:\\Users\\demo",
        localAppData: "C:\\Users\\demo\\AppData\\Local",
      }),
    ).toContain(join("Google", "Chrome", "User Data", "Default"));
    expect(
      resolveChromeDefaultProfilePath({
        platform: "linux",
        homeDir: "/home/demo",
      }),
    ).toBe(join("/home/demo", ".config", "google-chrome", "Default"));
  });

  it("One-click import of plaintext cookies from Default Profile", async () => {
    await mkdir(join(tempRoot, "Default"), { recursive: true });
    const profilePath = createChromeProfile();
    const set = vi.fn(async () => {});
    const flushStore = vi.fn(async () => {});
    const targetSession = {
      clearCache: vi.fn(async () => {}),
      clearStorageData: vi.fn(async () => {}),
      cookies: { set, flushStore },
    };
    const importedAt = Math.floor(Date.now() / 1000);

    const result = await importChromeBrowserData({
      logger,
      platform: "linux",
      profilePath,
      targetSession,
      localStorageImporter,
    });

    expect(result).toMatchObject({
      success: true,
      cookies: { imported: 1, skipped: 0, failed: 0 },
      localStorage: localStorageResult,
    });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com/",
        name: "session",
        value: "fixture-value",
        httpOnly: true,
        sameSite: "lax",
        expirationDate: expect.any(Number),
      }),
    );
    const cookieDetails = set.mock.calls[0]?.[0];
    expect(cookieDetails?.expirationDate).toBeGreaterThan(importedAt + 399 * 24 * 60 * 60);
    expect(flushStore).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith("[browser-data] Chrome Cookie 写入完成", {
      importedCount: 1,
      skippedCount: 0,
      failedCount: 0,
    });
  });

  it("Compatible with Network/Cookies database path in newer Chrome versions", async () => {
    await mkdir(join(tempRoot, "Default", "Network"), { recursive: true });
    const profilePath = createChromeProfile({ modernCookiePath: true });
    const set = vi.fn(async () => {});

    const result = await importChromeBrowserData({
      logger,
      platform: "linux",
      profilePath,
      localStorageImporter,
      targetSession: {
        clearCache: vi.fn(async () => {}),
        clearStorageData: vi.fn(async () => {}),
        cookies: { set, flushStore: vi.fn(async () => {}) },
      },
    });

    expect(result.success).toBe(true);
    expect(set).toHaveBeenCalledOnce();
  });

  it("Do not copy SHM potentially locked by Windows after online backup failure", async () => {
    await mkdir(join(tempRoot, "Default"), { recursive: true });
    const profilePath = createChromeProfile();
    const cookieDatabasePath = join(profilePath, "Cookies");
    lockedChromeSidecars.add(`${cookieDatabasePath}-shm`);
    const failingBackup = createFailingSourceBackup();
    const set = vi.fn(async () => {});

    const result = await importChromeBrowserData({
      chromeCookieDatabaseBackup: failingBackup.databaseBackup,
      logger,
      platform: "linux",
      profilePath,
      localStorageImporter,
      targetSession: {
        clearCache: vi.fn(async () => {}),
        clearStorageData: vi.fn(async () => {}),
        cookies: { set, flushStore: vi.fn(async () => {}) },
      },
    });

    expect(result.success).toBe(true);
    expect(set).toHaveBeenCalledOnce();
    expect(failingBackup.getCallCount()).toBe(2);
    expect(logger.warn).toHaveBeenCalledWith(
      "[browser-data] Chrome Cookie 在线备份不可用，回退 WAL 文件快照",
      { name: "Error", code: "ERR_SQLITE_ERROR" },
    );
  });

  it("Preserve committed cookies in Chrome WAL from file snapshot after online backup failure", async () => {
    await mkdir(join(tempRoot, "Default"), { recursive: true });
    const profilePath = createChromeProfile();
    const database = new DatabaseSync(join(profilePath, "Cookies"));
    database.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;");
    database
      .prepare("INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("wal.example.com", "wal-session", "/", 0n, 1n, 0n, 0n, "wal-value", Buffer.alloc(0));
    const failingBackup = createFailingSourceBackup();
    const set = vi.fn(async () => {});

    try {
      const result = await importChromeBrowserData({
        chromeCookieDatabaseBackup: failingBackup.databaseBackup,
        logger,
        platform: "linux",
        profilePath,
        localStorageImporter,
        targetSession: {
          clearCache: vi.fn(async () => {}),
          clearStorageData: vi.fn(async () => {}),
          cookies: { set, flushStore: vi.fn(async () => {}) },
        },
      });

      expect(result).toMatchObject({
        success: true,
        cookies: { imported: 2, skipped: 0, failed: 0 },
      });
      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({ name: "wal-session", value: "wal-value" }),
      );
      expect(failingBackup.getCallCount()).toBe(2);
    } finally {
      database.close();
    }
  });

  it("Return actionable error when Chrome Profile does not exist", async () => {
    const result = await importChromeBrowserData({
      logger,
      profilePath: join(tempRoot, "missing"),
    });

    expect(result).toMatchObject({
      success: false,
      error: "chrome_profile_not_found",
      cookies: { imported: 0 },
    });
  });

  it("macOS/Linux 未安装 Chrome 时在 Profile 发现前停止导入", async () => {
    const chromeExecutableDiscovery = vi.fn(async () => null);
    const chromeProfileDiscovery = vi.fn(async () => ({
      success: false as const,
      error: "chrome_profile_not_found" as const,
    }));

    const result = await importChromeBrowserData({
      logger,
      platform: "linux",
      chromeExecutableDiscovery,
      chromeProfileDiscovery,
    });

    expect(result).toMatchObject({
      success: false,
      error: "chrome_executable_not_found",
      cookies: { imported: 0 },
    });
    expect(chromeExecutableDiscovery).toHaveBeenCalledOnce();
    expect(chromeProfileDiscovery).not.toHaveBeenCalled();
    expect(localStorageImporter).not.toHaveBeenCalled();
  });

  it("Profile 自动发现无法消歧时不修改目标 session", async () => {
    const result = await importChromeBrowserData({
      logger,
      chromeExecutableDiscovery: async () => "/usr/bin/google-chrome",
      chromeProfileDiscovery: async () => ({
        success: false,
        error: "chrome_profile_ambiguous",
      }),
    });

    expect(result).toMatchObject({
      success: false,
      error: "chrome_profile_ambiguous",
      cookies: { imported: 0 },
    });
  });

  it("Abort entire import after macOS user denies Keychain authorization", async () => {
    await mkdir(join(tempRoot, "Default"), { recursive: true });
    const profilePath = createChromeProfile({
      value: "",
      encryptedValue: Buffer.concat([Buffer.from("v10"), Buffer.alloc(48, 1)]),
    });
    const set = vi.fn(async () => {});
    const flushStore = vi.fn(async () => {});
    const deniedError = Object.assign(new Error("User canceled the operation"), { code: 128 });
    const macChromeSafeStorageSecretReader = vi.fn(async () => {
      throw deniedError;
    });

    const result = await importChromeBrowserData({
      logger,
      platform: "darwin",
      profilePath,
      macChromeSafeStorageSecretReader,
      localStorageImporter,
      targetSession: {
        clearCache: vi.fn(async () => {}),
        clearStorageData: vi.fn(async () => {}),
        cookies: { set, flushStore },
      },
    });

    expect(result).toMatchObject({
      success: false,
      error: "chrome_cookie_access_denied",
      cookies: { imported: 0, skipped: 0, failed: 0 },
      localStorage: {
        originsImported: 0,
        entriesImported: 0,
        originsSkipped: 0,
        originsFailed: 0,
      },
    });
    expect(macChromeSafeStorageSecretReader).toHaveBeenCalledOnce();
    expect(set).not.toHaveBeenCalled();
    expect(flushStore).not.toHaveBeenCalled();
    expect(localStorageImporter).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "[browser-data] Chrome data import canceled: macOS Keychain authorization denied",
    );
  });

  it("Continue decrypting Linux v10 cookies in current process without starting Chrome helper", async () => {
    await mkdir(join(tempRoot, "Default"), { recursive: true });
    const profilePath = createChromeProfile({
      value: "",
      encryptedValue: encryptLinuxV10Cookie("linux-v10-value"),
    });
    const chromeCookieHelper = vi.fn(async () => []);
    const set = vi.fn(async () => {});

    const result = await importChromeBrowserData({
      logger,
      platform: "linux",
      profilePath,
      chromeExecutablePath: "/usr/bin/google-chrome",
      chromeCookieHelper,
      localStorageImporter,
      targetSession: {
        clearCache: vi.fn(async () => {}),
        clearStorageData: vi.fn(async () => {}),
        cookies: { set, flushStore: vi.fn(async () => {}) },
      },
    });

    expect(result).toMatchObject({
      success: true,
      cookies: { imported: 1, skipped: 0, failed: 0 },
    });
    expect(chromeCookieHelper).not.toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ value: "linux-v10-value" }));
  });

  it("Linux v11 cookies are decrypted by same-brand Chrome helper and forwarded to KWallet backend", async () => {
    await mkdir(join(tempRoot, "Default"), { recursive: true });
    const profilePath = createChromeProfile({
      value: "",
      encryptedValue: Buffer.concat([Buffer.from("v11"), Buffer.alloc(48, 1)]),
    });
    const chromeCookieHelper = vi.fn(async () => [
      {
        domain: ".example.com",
        expires: 0,
        httpOnly: true,
        name: "session",
        path: "/",
        sameSite: "Lax" as const,
        secure: true,
        session: true,
        value: "linux-v11-value",
      },
    ]);
    const set = vi.fn(async () => {});

    const result = await importChromeBrowserData({
      logger,
      platform: "linux",
      chromeExecutableDiscovery: async () => "/usr/bin/google-chrome",
      chromeProfileDiscovery: async () => ({
        success: true,
        source: {
          browser: "chrome",
          executablePath: "/usr/bin/google-chrome",
          passwordStore: "kwallet6",
          profileDirectory: "Default",
          profilePath,
          userDataDir: tempRoot,
        },
      }),
      chromeCookieHelper,
      localStorageImporter,
      targetSession: {
        clearCache: vi.fn(async () => {}),
        clearStorageData: vi.fn(async () => {}),
        cookies: { set, flushStore: vi.fn(async () => {}) },
      },
    });

    expect(chromeCookieHelper).toHaveBeenCalledWith(
      expect.objectContaining({
        executablePath: "/usr/bin/google-chrome",
        passwordStore: "kwallet6",
      }),
    );
    expect(result).toMatchObject({
      success: true,
      cookies: { imported: 1, skipped: 0, failed: 0 },
    });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ value: "linux-v11-value" }));
  });

  it("Linux v11 helper 不可用时保留 LocalStorage 并返回保护提示", async () => {
    await mkdir(join(tempRoot, "Default"), { recursive: true });
    const profilePath = createChromeProfile({
      value: "",
      encryptedValue: Buffer.concat([Buffer.from("v11"), Buffer.alloc(48, 1)]),
    });

    const result = await importChromeBrowserData({
      logger,
      platform: "linux",
      profilePath,
      chromeExecutablePath: "/usr/bin/google-chrome",
      chromeCookieHelper: vi.fn(async () => {
        throw new Error("keyring unavailable");
      }),
      localStorageImporter,
      targetSession: {
        clearCache: vi.fn(async () => {}),
        clearStorageData: vi.fn(async () => {}),
        cookies: {
          set: vi.fn(async () => {}),
          flushStore: vi.fn(async () => {}),
        },
      },
    });

    expect(result).toMatchObject({
      success: true,
      cookies: { imported: 0, skipped: 1 },
      localStorage: localStorageResult,
      issues: expect.arrayContaining(["chrome_cookie_protection_unsupported"]),
    });
  });

  it("Windows v20 cookies are decrypted by native helper after administrator authorization this time", async () => {
    await mkdir(join(tempRoot, "Default"), { recursive: true });
    const masterKey = Buffer.alloc(32, 9);
    const profilePath = createChromeProfile({
      value: "",
      encryptedValue: encryptWindowsCookieV20("helper-value", masterKey),
    });
    const helperResult = Buffer.from(masterKey);
    const windowsChromeAppBoundKeyReader = vi.fn(async () => helperResult);
    const failingBackup = createFailingSourceBackup();
    const set = vi.fn(async () => {});

    const result = await importChromeBrowserData({
      allowElevatedChromeDecryption: true,
      chromeCookieDatabaseBackup: failingBackup.databaseBackup,
      logger,
      platform: "win32",
      profilePath,
      chromeExecutablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      windowsChromeAppBoundKeyReader,
      localStorageImporter,
      targetSession: {
        clearCache: vi.fn(async () => {}),
        clearStorageData: vi.fn(async () => {}),
        cookies: { set, flushStore: vi.fn(async () => {}) },
      },
    });

    expect(windowsChromeAppBoundKeyReader).toHaveBeenCalledOnce();
    expect(failingBackup.getCallCount()).toBe(2);
    expect(windowsChromeAppBoundKeyReader).toHaveBeenCalledWith(
      expect.objectContaining({
        chromeExecutablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        userDataDir: tempRoot,
      }),
    );
    expect(result).toMatchObject({
      success: true,
      cookies: { imported: 1, skipped: 0, failed: 0 },
    });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ value: "helper-value", url: "https://example.com/" }),
    );
    expect(helperResult.every((value) => value === 0)).toBe(true);
  });

  it("Preserve LocalStorage and return stable error when Windows v20 helper is unavailable", async () => {
    await mkdir(join(tempRoot, "Default"), { recursive: true });
    const profilePath = createChromeProfile({
      value: "",
      encryptedValue: Buffer.concat([Buffer.from("v20"), Buffer.alloc(48, 1)]),
    });

    const result = await importChromeBrowserData({
      allowElevatedChromeDecryption: true,
      logger,
      platform: "win32",
      profilePath,
      chromeExecutablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      windowsChromeAppBoundKeyReader: vi.fn(async () => {
        throw new WindowsChromeAppBoundImportError("chrome_cookie_helper_verification_failed");
      }),
      localStorageImporter,
      targetSession: {
        clearCache: vi.fn(async () => {}),
        clearStorageData: vi.fn(async () => {}),
        cookies: {
          set: vi.fn(async () => {}),
          flushStore: vi.fn(async () => {}),
        },
      },
    });

    expect(result).toMatchObject({
      success: true,
      cookies: { imported: 0, skipped: 1 },
      localStorage: localStorageResult,
      issues: expect.arrayContaining(["chrome_cookie_helper_verification_failed"]),
    });
  });

  it("Do not write entire batch of cookies when Windows v20 authorization fails", async () => {
    await mkdir(join(tempRoot, "Default"), { recursive: true });
    const profilePath = createChromeProfile({
      value: "",
      encryptedValue: Buffer.concat([Buffer.from("v20"), Buffer.alloc(48, 1)]),
    });
    const cookieDatabase = new DatabaseSync(join(profilePath, "Cookies"));
    cookieDatabase
      .prepare("INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("plain.example.com", "plain", "/", 0n, 1n, 1n, 1n, "plain-value", Buffer.alloc(0));
    cookieDatabase.close();
    const set = vi.fn(async () => {});

    const result = await importChromeBrowserData({
      allowElevatedChromeDecryption: true,
      logger,
      platform: "win32",
      profilePath,
      chromeExecutablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      windowsChromeAppBoundKeyReader: vi.fn(async () => {
        throw new WindowsChromeAppBoundImportError("chrome_cookie_elevation_cancelled");
      }),
      localStorageImporter,
      targetSession: {
        clearCache: vi.fn(async () => {}),
        clearStorageData: vi.fn(async () => {}),
        cookies: { set, flushStore: vi.fn(async () => {}) },
      },
    });

    expect(set).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      cookies: { imported: 0, skipped: 2, failed: 0 },
      localStorage: localStorageResult,
      issues: expect.arrayContaining(["chrome_cookie_elevation_cancelled"]),
    });
  });

  it("Do not start helper without current confirmation on Windows, but LocalStorage can still be imported", async () => {
    await mkdir(join(tempRoot, "Default"), { recursive: true });
    const profilePath = createChromeProfile({
      value: "",
      encryptedValue: Buffer.concat([Buffer.from("v20"), Buffer.alloc(48, 1)]),
    });
    const windowsChromeAppBoundKeyReader = vi.fn(async () => Buffer.alloc(32));

    const result = await importChromeBrowserData({
      logger,
      platform: "win32",
      profilePath,
      chromeExecutablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      windowsChromeAppBoundKeyReader,
      localStorageImporter,
      targetSession: {
        clearCache: vi.fn(async () => {}),
        clearStorageData: vi.fn(async () => {}),
        cookies: { set: vi.fn(async () => {}), flushStore: vi.fn(async () => {}) },
      },
    });

    expect(windowsChromeAppBoundKeyReader).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      localStorage: localStorageResult,
      issues: expect.arrayContaining(["chrome_cookie_elevation_required"]),
    });
  });

  it("Can still import only LocalStorage when cookie database is missing", async () => {
    const profilePath = join(tempRoot, "Default");
    await mkdir(profilePath, { recursive: true });

    const result = await importChromeBrowserData({
      logger,
      profilePath,
      localStorageImporter,
      targetSession: {
        clearCache: vi.fn(async () => {}),
        clearStorageData: vi.fn(async () => {}),
        cookies: {
          set: vi.fn(async () => {}),
          flushStore: vi.fn(async () => {}),
        },
      },
    });

    expect(result).toMatchObject({
      success: true,
      cookies: { imported: 0 },
      localStorage: localStorageResult,
    });
  });

  it("只从 Chrome LocalStorage metadata key 发现 HTTP(S) origin", async () => {
    const localStoragePath = join(tempRoot, "Local Storage");
    const levelDbPath = join(localStoragePath, "leveldb");
    await mkdir(levelDbPath, { recursive: true });
    await writeFile(
      join(levelDbPath, "000001.ldb"),
      Buffer.from(
        "binary\0META:https://chat.z.ai\0META:http://localhost:3000\0META:chrome-extension://ignored",
        "latin1",
      ),
    );

    await expect(discoverChromeLocalStorageOrigins(localStoragePath)).resolves.toEqual([
      "http://localhost:3000",
      "https://chat.z.ai",
    ]);
  });

  it("Copy LocalStorage snapshot first, then discover origins from snapshot", async () => {
    const profilePath = join(tempRoot, "Default");
    const levelDbPath = join(profilePath, "Local Storage", "leveldb");
    await mkdir(levelDbPath, { recursive: true });
    await writeFile(
      join(levelDbPath, "000001.ldb"),
      Buffer.from("binary\0META:https://chat.z.ai", "latin1"),
    );

    const result = await importChromeLocalStorage({
      profilePath,
      platform: "aix",
      logger,
      targetSession: {} as Electron.Session,
    });

    expect(result).toMatchObject({
      originsImported: 0,
      originsFailed: 1,
      error: "chrome_executable_not_found",
    });
  });

  it("Normal cleanup preserves cookies; full cleanup uses Electron full storage cleanup", async () => {
    const clearCache = vi.fn(async () => {});
    const clearStorageData = vi.fn(async () => {});
    const targetSession = {
      clearCache,
      clearStorageData,
      cookies: {
        set: vi.fn(async () => {}),
        flushStore: vi.fn(async () => {}),
      },
    };

    await clearEmbeddedBrowserData({ logger, mode: "cache", targetSession });
    expect(clearStorageData).toHaveBeenNthCalledWith(1, {
      storages: ["shadercache", "serviceworkers", "cachestorage"],
    });

    await clearEmbeddedBrowserData({ logger, mode: "all", targetSession });
    expect(clearStorageData).toHaveBeenNthCalledWith(2);
    expect(clearCache).toHaveBeenCalledTimes(2);
  });

  it("Full cleanup also clears site permission consent records; normal cleanup preserves them", async () => {
    const clearCache = vi.fn(async () => {});
    const clearStorageData = vi.fn(async () => {});
    const targetSession = {
      clearCache,
      clearStorageData,
      cookies: { set: vi.fn(async () => {}), flushStore: vi.fn(async () => {}) },
    };
    resetEmbeddedBrowserSitePermissionsForTest();
    await initEmbeddedBrowserSitePermissions({ logger });
    await writeEmbeddedBrowserSitePermission("https://example.com", "media", "allow");

    await clearEmbeddedBrowserData({ logger, mode: "cache", targetSession });
    expect(snapshotSitePermissions()).toEqual({
      "https://example.com": { media: "allow" },
    });

    await clearEmbeddedBrowserData({ logger, mode: "all", targetSession });
    expect(snapshotSitePermissions()).toEqual({});
    resetEmbeddedBrowserSitePermissionsForTest();
  });
});
