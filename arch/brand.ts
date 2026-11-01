/**
 * Part registry and alias ladder.
 *
 * A part is called by its codename. An alias is an edition label that resolves to exactly
 * one part; `null` means the alias seat is retired ("#"). Ingot is not the "main" part:
 * the alias "Max" only says it is the largest tree on disk.
 * Mirrors `arch/windows.json`.
 */

export type PartStatus = "present" | "empty";
export type PartAlias = "Lite" | "Plus" | "Pro" | "Studio" | "Max" | "Ultra";

export interface PartRecord {
  readonly codename: string;
  readonly alias: PartAlias | null;
  readonly folder: string;
  readonly contents: string;
  readonly status: PartStatus;
}

export const LAUNCHER = {
  name: "Launcher Desktop",
  windowTitle: "Launcher",
  folder: "launcher",
  role: "Starts any part. No product logic of its own.",
  status: "shell" as const,
};

/** Edition ladder, lightest to heaviest. "Core" is retired and maps to no part. */
export const ALIAS_LADDER: readonly PartAlias[] = ["Lite", "Plus", "Pro", "Studio", "Max", "Ultra"];

export const PARTS: readonly PartRecord[] = [
  {
    codename: "Ingot",
    alias: "Max",
    folder: "windows/ingot",
    contents: "Monorepo tree - apps/, packages/, config/, docs/, node_modules; 160,239 files (3.9 GB). Role is NOT decided.",
    status: "present",
  },
  {
    codename: "Onyx",
    alias: "Studio",
    folder: "windows/onyx",
    contents: "Reverse-engineered Qoder desktop build - CodeFusion.exe plus SOURCE/; 4,715 files (943 MB).",
    status: "present",
  },
  {
    codename: "Chromix",
    alias: null,
    folder: "windows/chromix",
    contents: "Zephium browser source - package name 'zephium', crates/, desktop/, eval/; 3,691 files.",
    status: "present",
  },
  {
    codename: "Codeix",
    alias: "Pro",
    folder: "windows/codeix",
    contents: "Two OpenAI Codex MSIX packages (ui-old, ui-new) and a toggle; 2 files (1.6 GB).",
    status: "present",
  },
  {
    codename: "GSX-CLI",
    alias: null,
    folder: "windows/gsx-cli",
    contents: "opencode workspace - package name 'opencode', packages/, bun.lock; 2,060 files. Holds MiMoCode source code from Xiaomi.",
    status: "present",
  },
  {
    codename: "Zingma",
    alias: "Lite",
    folder: "windows/zingma",
    contents: "Empty - only window.json. Seat reserved for Qoder's native built-in Quest/agents window.",
    status: "empty",
  },
  {
    codename: "Sonar",
    alias: "Plus",
    folder: "windows/sonar",
    contents: "Empty - only window.json. Seat for the reverse-engineered DeepSeek Harness (DSH).",
    status: "empty",
  },
  {
    codename: "Zenix CC",
    alias: "Ultra",
    folder: "windows/zenix-cc",
    contents: "Empty - only window.json. Seat for native Claude Desktop.",
    status: "empty",
  },
] as const;

/** Alias -> codename. Aliases with no part (retired) are absent. */
export const ALIASES: Readonly<Record<PartAlias, string>> = {
  Lite: "Zingma",
  Plus: "Sonar",
  Pro: "Codeix",
  Studio: "Onyx",
  Max: "Ingot",
  Ultra: "Zenix CC",
};

/** Case-insensitive lookup by codename. */
export function findPart(name: string): PartRecord | undefined {
  const needle = name.trim().toLowerCase();
  return PARTS.find((part) => part.codename.toLowerCase() === needle);
}

/** Resolve an alias ("Studio", "studio") to its part. */
export function findPartByAlias(alias: string): PartRecord | undefined {
  const needle = alias.trim().toLowerCase();
  const codename = Object.entries(ALIASES).find(([key]) => key.toLowerCase() === needle)?.[1];
  return codename === undefined ? undefined : findPart(codename);
}

/** Accept either a codename or an alias. */
export function resolvePart(name: string): PartRecord | undefined {
  return findPart(name) ?? findPartByAlias(name);
}
