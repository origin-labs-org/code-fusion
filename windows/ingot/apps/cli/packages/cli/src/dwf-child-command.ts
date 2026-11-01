

import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { createContext, runInContext } from "node:vm";
import { CF_DWF_CHILD_COMMAND } from "@origin-ai/cf-contracts";
import type { RunContext } from "@origin-ai/cf-shared-types";

export function isDwfChildInvocation(argv: readonly string[]): boolean {
  return argv[0] === CF_DWF_CHILD_COMMAND;
}

interface ChildEntryModule {
  start?: (deps: {
    vm: { createContext: typeof createContext; runInContext: typeof runInContext };
    createInterface: typeof createInterface;
    stdin: NodeJS.ReadableStream;
    stdout: { write(chunk: string): unknown };
  }) => Promise<void>;
}

export async function runDwfChildCommand(ctx: RunContext, argv: string[]): Promise<number> {
  const entryPath = argv[argv.length - 1];
  if (argv.length === 0 || entryPath === undefined) {
    ctx.stderr.write(`Usage: ${CF_DWF_CHILD_COMMAND} <entry path>\n`);
    return 1;
  }

  try {
    const entry = (await import(pathToFileURL(resolve(entryPath)).href)) as ChildEntryModule;
    if (typeof entry.start !== "function") {
      throw new Error(`workflow entry file exports no start(): ${entryPath}`);
    }
    await entry.start({
      vm: { createContext, runInContext },
      createInterface,
      stdin: ctx.stdin,
      stdout: ctx.stdout,
    });
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.stderr.write(`Workflow child failed: ${message}\n`);
    return 1;
  }
}
