import { Duplex } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import type { StdioStream } from "@origin-ai/cf-server/remote/backend.js";

export interface RemoteExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("Source Server transport operation was canceled");
  error.name = "AbortError";
  throw error;
}

export function readLastJsonLine(value: string): Record<string, unknown> {
  const lines = value.split(/\r?\n/u);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!.trim();
    if (!line.startsWith("{")) continue;
    try {
      return JSON.parse(line) as Record<string, unknown>;
    } catch {
    }
  }
  throw new Error("Remote command returned no JSON result");
}

export function readStructuredCommandError(value: string): string | null {
  try {
    const response = readLastJsonLine(value);
    return typeof response.error === "string" && response.error.trim()
      ? response.error.trim()
      : null;
  } catch {
    return null;
  }
}

export function readUniqueVersion(value: string): string | undefined {
  const semver = "(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)";
  const trimmed = value.trim();
  const exact = new RegExp(`^v?${semver}$`, "u").exec(trimmed)?.[1];
  if (exact) return exact;
  const versions = new Set<string>();
  const exactLine = new RegExp(`^v?${semver}$`, "u");
  for (const line of value.split(/\r?\n/u)) {
    const version = exactLine.exec(line.trim())?.[1];
    if (version) versions.add(version);
  }
  const labelled = new RegExp(
    `\\b(?:cf|source[ -]server)\\b[^\\n]*?\\bversion\\s*[:=]?\\s*v?${semver}\\b`,
    "giu",
  );
  for (const match of value.matchAll(labelled)) {
    const version = match[1];
    if (version) versions.add(version);
  }
  return versions.size === 1 ? versions.values().next().value : undefined;
}

function waitForClose(stream: StdioStream): Promise<number> {
  return new Promise((resolve) => {
    const subscription = stream.onClose((code) => {
      subscription.dispose();
      resolve(code);
    });
  });
}

async function readText(stream: NodeJS.ReadableStream, onLine?: (line: string) => void): Promise<string> {
  const chunks: Buffer[] = [];
  const decoder = new StringDecoder("utf8");
  let pending = "";
  for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array | string>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buffer);
    if (onLine) {
      pending += decoder.write(buffer);
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        onLine(pending.slice(0, newline).replace(/\r$/u, ""));
        pending = pending.slice(newline + 1);
      }
    }
  }
  if (onLine && (pending += decoder.end())) onLine(pending);
  return Buffer.concat(chunks).toString("utf8");
}

export async function collectCommand(stream: StdioStream, onStdoutLine?: (line: string) => void): Promise<RemoteExecResult> {
  const [stdout, stderr, exitCode] = await Promise.all([
    readText(stream.stdout, onStdoutLine),
    readText(stream.stderr),
    waitForClose(stream),
  ]);
  return { exitCode, stdout, stderr };
}

export function duplexFromStdio(stream: StdioStream): Duplex {
  const input = stream.stdin;
  const output = stream.stdout;
  const duplex = new Duplex({
    read() {
      output.resume();
    },
    write(chunk, encoding, callback) {
      if (input.write(chunk, encoding)) callback();
      else input.once("drain", callback);
    },
    final(callback) {
      input.end(callback);
    },
    destroy(error, callback) {
      const destroyableInput = input as NodeJS.WritableStream & {
        destroy?: (error?: Error | null) => void;
      };
      const destroyableOutput = output as NodeJS.ReadableStream & {
        destroy?: (error?: Error | null) => void;
      };
      destroyableInput.destroy?.(error);
      destroyableOutput.destroy?.(error);
      callback(error);
    },
  });
  output.pause();
  output.on("data", (chunk) => {
    if (!duplex.push(chunk)) output.pause();
  });
  output.once("end", () => duplex.push(null));
  output.once("error", (error) => duplex.destroy(error));
  input.once("error", (error) => duplex.destroy(error));
  stream.onClose((code) => {
    if (code !== 0) duplex.destroy(new Error(`proxy-stdio exited with code ${code}`));
    else duplex.push(null);
  });
  return duplex;
}
