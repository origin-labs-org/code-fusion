import { readFileSync } from "node:fs";

export function readSourceText(path: string | URL, encoding: BufferEncoding = "utf8"): string {
  return readFileSync(path, encoding).replace(/\r\n/g, "\n");
}
