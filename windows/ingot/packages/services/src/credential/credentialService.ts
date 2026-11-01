import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWritePrivateTextFile, backupCorruptFile, withFileLock } from "@origin-ai/cf-shared/node";
import {
  credentialKeySchema,
  credentialRecordSchema,
  credentialValueSchema,
  formatZodError,
  isCredentialDecryptError,
} from "@origin-ai/cf-shared";
import type { ICredentialService } from "./credential.js";
import {
  createCredentialCipherProvider,
  type CredentialCipherProvider,
} from "./providers/credentialCipherProvider.js";
import { createServiceLogger } from "../logger/serviceLogger.js";
import { getAppConfigDir } from "../paths.js";

const logger = createServiceLogger("credentialService");

function getCredentialsDir() {
  return getAppConfigDir();
}

function getCredentialsFile() {
  return join(getCredentialsDir(), "credentials.json");
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

async function readAll(credentialsFile = getCredentialsFile()): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await readFile(credentialsFile, "utf-8");
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return {};
    }
    throw new Error(`Unable to read CodeFusion credentials: ${credentialsFile}`, { cause: error });
  }

  try {
    const rawValue = JSON.parse(raw);
    const result = credentialRecordSchema.safeParse(rawValue);
    if (!result.success) {
      throw new Error(formatZodError(result.error));
    }
    return result.data;
  } catch (error) {
    const backupPath = await backupCorruptFile(credentialsFile).catch(() => undefined);
    logger.warn(undefined, "read failed; refusing to overwrite corrupt credential store", {
      backupPath,
      credentialsFile,
    });
    throw new Error(`CodeFusion credentials are corrupt: ${credentialsFile}`, { cause: error });
  }
}

async function writeAll(credentialsFile: string, data: Record<string, string>): Promise<void> {
  await atomicWritePrivateTextFile(credentialsFile, `${JSON.stringify(data, null, 2)}\n`);
}

interface CredentialServiceDependencies {
  cipherProvider?: CredentialCipherProvider;
  
  onDidMutate?: (event: { operation: "save" | "delete"; key: string }) => void;
}

export interface LocalCredentialService extends ICredentialService {
  recoverUnreadable(key: string, assertCurrent: () => void): Promise<string | null>;
  save(key: string, value: string, assertCurrent?: () => void): Promise<void>;
  delete(key: string, assertCurrent?: () => void): Promise<void>;
}

export function createCredentialService(
  dependencies: CredentialServiceDependencies = {},
): LocalCredentialService {
  const cipherProvider = dependencies.cipherProvider ?? createCredentialCipherProvider();

  return {
    async recoverUnreadable(key, assertCurrent) {
      const validatedKey = credentialKeySchema.parse(key);
      const credentialsFile = getCredentialsFile();
      let deleted = false;
      const value = await withFileLock(credentialsFile, async () => {
        assertCurrent();
        const creds = await readAll(credentialsFile);
        assertCurrent();
        const rawValue = creds[validatedKey];
        if (rawValue === undefined) return null;
        try {
          return cipherProvider.decrypt(rawValue);
        } catch (error) {
          if (!isCredentialDecryptError(error)) throw error;
        }
        assertCurrent();
        delete creds[validatedKey];
        await writeAll(credentialsFile, creds);
        deleted = true;
        return null;
      });
      if (deleted) dependencies.onDidMutate?.({ operation: "delete", key: validatedKey });
      return value;
    },

    async load(key: string): Promise<string | null> {
      const validatedKey = credentialKeySchema.parse(key);
      const creds = await readAll();
      const rawValue = creds[validatedKey];
      if (rawValue === undefined) {
        return null;
      }

      return cipherProvider.decrypt(rawValue);
    },

    async save(key: string, value: string, assertCurrent?: () => void): Promise<void> {
      const validatedKey = credentialKeySchema.parse(key);
      const validatedValue = credentialValueSchema.parse(value);
      const encryptedValue = cipherProvider.encrypt(validatedValue);
      const credentialsFile = getCredentialsFile();
      await withFileLock(credentialsFile, async () => {
        const creds = await readAll(credentialsFile);
        assertCurrent?.();
        creds[validatedKey] = encryptedValue;
        await writeAll(credentialsFile, creds);
      });
      dependencies.onDidMutate?.({ operation: "save", key: validatedKey });
    },

    async delete(key: string, assertCurrent?: () => void): Promise<void> {
      const validatedKey = credentialKeySchema.parse(key);
      const credentialsFile = getCredentialsFile();
      await withFileLock(credentialsFile, async () => {
        const creds = await readAll(credentialsFile);
        assertCurrent?.();
        delete creds[validatedKey];
        await writeAll(credentialsFile, creds);
      });
      dependencies.onDidMutate?.({ operation: "delete", key: validatedKey });
    },
  };
}
