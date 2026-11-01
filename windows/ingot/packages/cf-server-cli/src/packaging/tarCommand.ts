import { existsSync } from "node:fs";
import { join } from "node:path";

export function resolveHostTarCommand(): string {
  if (process.platform !== "win32") return "tar";
  const system32Tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  if (!existsSync(system32Tar)) {
    throw new Error(
      `System32 tar.exe missing (${system32Tar}); Windows staging requires the OS-bundled bsdtar`,
    );
  }
  return system32Tar;
}

export function isTarCommand(command: string): boolean {
  return command === "tar" || command.endsWith("\\tar.exe") || command.endsWith("/tar");
}
