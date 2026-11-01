import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWritePrivateTextFile, withFileLock } from "@origin-ai/cf-shared/node";
import {
  decodeCfBuiltinRelease,
  serializeCfBuiltinRelease,
} from "./cf-builtin-release.js";

export interface MaterializeCfBuiltinProviderConfigOptions {
  readonly environmentConfigRoot: string;
  readonly content: string;
}

export async function materializeCfBuiltinProviderConfig(
  options: MaterializeCfBuiltinProviderConfigOptions,
): Promise<string> {
  const content = `${serializeCfBuiltinRelease(
    decodeCfBuiltinRelease(JSON.parse(options.content)),
  )}\n`;
  const filePath = join(
    options.environmentConfigRoot,
    "runtime",
    "provider",
    "bundled",
    "cf-builtin.json",
  );
  await withFileLock(filePath, async () => {
    if ((await readOptionalFile(filePath)) !== content) {
      await atomicWritePrivateTextFile(filePath, content);
    }
  });
  return filePath;
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
