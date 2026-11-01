import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const v4Dir = fileURLToPath(
  new URL("../src/cf-protocol-v4/", import.meta.url),
);

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectTsFiles(fullPath));
      continue;
    }
    if (entry.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

function collectImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const staticPattern = /(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/g;
  const dynamicPattern = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const pattern of [staticPattern, dynamicPattern]) {
    for (const match of source.matchAll(pattern)) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

function isLegacyProtocolImport(specifier: string): boolean {
  return /(?:^|\/)cf-protocol\//.test(specifier.replace(/\\/g, "/"));
}

describe("v4 原生边界禁令（无桥）", () => {
  it("cf-protocol-v4/ 下任何文件不得 import 旧协议目录（cf-protocol/）", () => {
    const violations: string[] = [];
    for (const file of collectTsFiles(v4Dir)) {
      const source = readFileSync(file, "utf8");
      for (const specifier of collectImportSpecifiers(source)) {
        if (isLegacyProtocolImport(specifier)) {
          violations.push(`${relative(v4Dir, file)} → ${specifier}`);
        }
      }
    }
    expect(
      violations,
      `v4 原生层出现对OldProtocol的 import（违反 08-phasing M4「无桥」禁令）：\n${violations.join("\n")}`,
    ).toEqual([]);
  });
});
