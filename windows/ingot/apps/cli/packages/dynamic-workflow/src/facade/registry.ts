import ts from "typescript";
import { FACADE_FILE_NAME } from "./dts.js";

interface WorldReadRow {
  
  readonly container: string;
  
  readonly member: string;
  
  readonly op: string;
}

export const WORLD_READ_REGISTRY = [
  { container: "files", member: "glob", op: "glob" },
  { container: "files", member: "read", op: "read" },
  { container: "files", member: "grep", op: "grep" },
  { container: "git", member: "changedFiles", op: "git-changed-files" },
  { container: "git", member: "diff", op: "git-diff" },
  { container: "git", member: "status", op: "git-status" },
  { container: "git", member: "log", op: "git-log" },
  { container: "world", member: "run", op: "run" },
] as const satisfies readonly WorldReadRow[];

export type WorldReadOp = (typeof WORLD_READ_REGISTRY)[number]["op"];

export interface ArtifactRow {
  
  readonly container: "artifact";
  
  readonly member: string;
  
  readonly op: string;
  
  readonly family: "content" | "preset";
}

export const ARTIFACT_REGISTRY = [
  { container: "artifact", member: "file", op: "file", family: "content" },
  { container: "artifact", member: "markdown", op: "markdown", family: "content" },
  { container: "artifact", member: "chart", op: "chart", family: "preset" },
  { container: "artifact", member: "table", op: "table", family: "preset" },
  { container: "artifact", member: "metrics", op: "metrics", family: "preset" },
  { container: "artifact", member: "board", op: "board", family: "preset" },
] as const satisfies readonly ArtifactRow[];

export type ArtifactOp = (typeof ARTIFACT_REGISTRY)[number]["op"];

export type ArtifactContentOp = Extract<
  (typeof ARTIFACT_REGISTRY)[number],
  { family: "content" }
>["op"];

export type ArtifactPresetOp = Extract<
  (typeof ARTIFACT_REGISTRY)[number],
  { family: "preset" }
>["op"];

function artifactRow(
  container: string | undefined,
  member: string,
): (typeof ARTIFACT_REGISTRY)[number] | undefined {
  if (container === undefined) return undefined;
  return ARTIFACT_REGISTRY.find((row) => row.container === container && row.member === member);
}

export function artifactRowOfSymbol(
  symbol: ts.Symbol | undefined,
): (typeof ARTIFACT_REGISTRY)[number] | undefined {
  const member = facadeMemberOf(symbol);
  if (member === undefined) return undefined;
  return artifactRow(member.container, member.member);
}

export function artifactFamilyOf(op: ArtifactOp): "content" | "preset" {
  const row = ARTIFACT_REGISTRY.find((candidate) => candidate.op === op);
  if (row === undefined) throw new Error(`unknown artifact op: ${op}`);
  return row.family;
}

export function isArtifactPresetOp(op: string): op is ArtifactPresetOp {
  return ARTIFACT_REGISTRY.some((row) => row.op === op && row.family === "preset");
}

const ASK_MEMBER = { container: "Agent", member: "ask" } as const;

const SITE_PRODUCING_FUNCTIONS = ["agent", "report", "hole"] as const;

type SiteProducingFunction = (typeof SITE_PRODUCING_FUNCTIONS)[number];

export function siteProducingFunctionOfSymbol(
  symbol: ts.Symbol | undefined,
): SiteProducingFunction | undefined {
  const member = facadeMemberOf(symbol);
  if (member === undefined || member.container !== undefined) return undefined;
  return SITE_PRODUCING_FUNCTIONS.find((name) => name === member.member);
}

const MARKER_FUNCTIONS = ["phase"] as const;

type MarkerFunction = (typeof MARKER_FUNCTIONS)[number];

export function markerFunctionOfSymbol(
  symbol: ts.Symbol | undefined,
): MarkerFunction | undefined {
  const member = facadeMemberOf(symbol);
  if (member === undefined || member.container !== undefined) return undefined;
  return MARKER_FUNCTIONS.find((name) => name === member.member);
}

const VALUE_FUNCTIONS = ["model"] as const;

type ValueFunction = (typeof VALUE_FUNCTIONS)[number];

export function valueFunctionOfSymbol(symbol: ts.Symbol | undefined): ValueFunction | undefined {
  const member = facadeMemberOf(symbol);
  if (member === undefined || member.container !== undefined) return undefined;
  return VALUE_FUNCTIONS.find((name) => name === member.member);
}

export const SITE_MEMBER_NAMES: ReadonlySet<string> = new Set<string>([
  ASK_MEMBER.member,
  ...WORLD_READ_REGISTRY.map((row) => row.member),
  ...ARTIFACT_REGISTRY.map((row) => row.member),
]);

export function worldReadOp(
  container: string | undefined,
  member: string,
): WorldReadOp | undefined {
  if (container === undefined) return undefined;
  return WORLD_READ_REGISTRY.find((row) => row.container === container && row.member === member)
    ?.op;
}

export function isSiteProducing(container: string | undefined, member: string): boolean {
  if (container === undefined) return SITE_PRODUCING_FUNCTIONS.some((name) => name === member);
  if (container === ASK_MEMBER.container && member === ASK_MEMBER.member) return true;
  if (artifactRow(container, member) !== undefined) return true;
  return worldReadOp(container, member) !== undefined;
}

export function facadeContainerOf(declaration: ts.Node | undefined): string | undefined {
  if (declaration === undefined) return undefined;
  if (declaration.getSourceFile().fileName !== FACADE_FILE_NAME) return undefined;
  for (let node: ts.Node | undefined = declaration.parent; node !== undefined; node = node.parent) {
    if (ts.isVariableDeclaration(node)) {
      return ts.isIdentifier(node.name) ? node.name.text : undefined;
    }
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return node.name.text;
    if (ts.isSourceFile(node)) return undefined;
  }
  return undefined;
}

export function facadeMemberOf(
  symbol: ts.Symbol | undefined,
): { container: string | undefined; member: string } | undefined {
  const declaration = symbol?.declarations?.find(
    (decl) => decl.getSourceFile().fileName === FACADE_FILE_NAME,
  );
  if (declaration === undefined || symbol === undefined) return undefined;
  return { container: facadeContainerOf(declaration), member: symbol.name };
}

export function worldReadOpOfSymbol(symbol: ts.Symbol | undefined): WorldReadOp | undefined {
  const member = facadeMemberOf(symbol);
  if (member === undefined) return undefined;
  return worldReadOp(member.container, member.member);
}
