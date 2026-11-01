import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

export function readSourceText(path: string | URL, encoding: BufferEncoding = "utf8"): string {
  return readFileSync(path, encoding).replace(/\r\n/g, "\n");
}

export async function readSourceTextAsync(
  path: string | URL,
  encoding: BufferEncoding = "utf8",
): Promise<string> {
  return (await readFile(path, encoding)).replace(/\r\n/g, "\n");
}
