import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createEncodedPowerShellArgs } from "../../scripts/powershell-command.mjs";

const SYSTEM_CREDENTIAL_TIMEOUT_MS = 15_000;
// errSecInteractionNotAllowed(-25308) -> 36、errSecAuthFailed(-25293) -> 51、
const MAC_KEYCHAIN_ACCESS_DENIED_EXIT_CODES = new Set([36, 51, 128]);

export type MacChromeSafeStorageSecretReader = () => Promise<string>;

export class ChromeCookieAccessDeniedError extends Error {
  readonly code = "chrome_cookie_access_denied";

  constructor() {
    super("chrome_cookie_access_denied");
    this.name = "ChromeCookieAccessDeniedError";
  }
}

function execFileText(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        timeout: SYSTEM_CREDENTIAL_TIMEOUT_MS,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

function isMacKeychainAccessDenied(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = error.code;
  return typeof code === "number" && MAC_KEYCHAIN_ACCESS_DENIED_EXIT_CODES.has(code);
}

export async function readMacChromeSafeStorageSecret(
  secretReader: MacChromeSafeStorageSecretReader = () =>
    execFileText("security", ["find-generic-password", "-w", "-s", "Chrome Safe Storage"]),
): Promise<string> {
  try {
    return await secretReader();
  } catch (error) {
    if (isMacKeychainAccessDenied(error)) throw new ChromeCookieAccessDeniedError();
    throw error;
  }
}

export async function readWindowsChromeMasterKey(userDataDir: string): Promise<Buffer> {
  const localState = JSON.parse(await readFile(join(userDataDir, "Local State"), "utf8")) as {
    os_crypt?: { encrypted_key?: string };
  };
  const encryptedKey = localState.os_crypt?.encrypted_key;
  if (!encryptedKey) throw new Error("chrome_master_key_missing");
  const script = [
    "Add-Type -AssemblyName System.Security;",
    "$data=[Convert]::FromBase64String($cfArg0);",
    "if ([Text.Encoding]::ASCII.GetString($data,0,5) -eq 'DPAPI') {$data=$data[5..($data.Length-1)]};",
    "$plain=[Security.Cryptography.ProtectedData]::Unprotect($data,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);",
    "[Convert]::ToBase64String($plain)",
  ].join("");
  const output = await execFileText(
    "powershell.exe",
    createEncodedPowerShellArgs(script, [encryptedKey]),
  );
  return Buffer.from(output, "base64");
}
