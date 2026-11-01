import { SCRIPT_PRELUDE_LENGTH, type ScriptLoc } from "../compiler/compile.js";
import { holePrefixOf } from "./hole-id.js";
import type { SiteTable } from "./sites.js";

export interface SplicedHoleBody {
  text: string;
  insertedAtLine: number;
  insertedLines: number;
}

const BODY_EXTRA_INDENT = 2;

export function spliceHoleBody(
  scriptText: string,
  table: SiteTable,
  holeSiteId: string,
  body: string,
): SplicedHoleBody | undefined {
  const site = table.holes.find((hole) => hole.id === holeSiteId);
  if (site === undefined || site.body !== undefined) return undefined;
  const lastArg = site.call.arguments[site.call.arguments.length - 1];
  if (lastArg === undefined) return undefined;
  const insertAt = lastArg.getEnd() - SCRIPT_PRELUDE_LENGTH;
  const lineStart = scriptText.lastIndexOf("\n", site.call.getStart() - SCRIPT_PRELUDE_LENGTH) + 1;
  const indent = /^[ \t]*/.exec(scriptText.slice(lineStart))?.[0] ?? "";
  const bodyIndent = `${indent}${" ".repeat(BODY_EXTRA_INDENT)}`;
  const bodyLines = body.replace(/\r?\n$/, "").split(/\r?\n/);
  const inserted = [
    ", async () => {",
    ...bodyLines.map((line) => (line.trim() === "" ? "" : `${bodyIndent}${line}`)),
    `${indent}}`,
  ];
  const before = scriptText.slice(0, insertAt);
  const text = `${before}${inserted.join("\n")}${scriptText.slice(insertAt)}`;
  const callLine = before.split("\n").length;
  return { insertedAtLine: callLine + 1, insertedLines: inserted.length - 1, text };
}

export type SiteStability = { ok: true } | { ok: false; detail: string };

interface LocatedSite {
  id: string;
  loc: ScriptLoc;
}

function everySite(table: SiteTable): LocatedSite[] {
  return [
    ...table.asks,
    ...table.actors,
    ...table.worldReads,
    ...table.joins,
    ...table.reports,
    ...table.artifacts,
    ...table.holes,
  ].map((site) => ({ id: site.id, loc: site.loc }));
}

export function checkSiteStability(
  before: SiteTable,
  after: SiteTable,
  holeSiteId: string,
  insertedAtLine: number,
  insertedLines: number,
): SiteStability {
  const afterById = new Map(everySite(after).map((site) => [site.id, site.loc]));
  const parenLine = insertedAtLine - 1;
  for (const site of everySite(before)) {
    const moved = afterById.get(site.id);
    if (moved === undefined)
      return { detail: `site ${site.id} vanished after the fill`, ok: false };
    const shifted = site.loc.line >= parenLine;
    const expectedLine = shifted ? site.loc.line + insertedLines : site.loc.line;
    const sameLine =
      moved.line === expectedLine || (site.loc.line === parenLine && moved.line === site.loc.line);
    const sameColumn = site.loc.line === parenLine || moved.column === site.loc.column;
    if (!sameLine || !sameColumn) {
      return {
        detail:
          `site ${site.id} moved from ${site.loc.line}:${site.loc.column} to ${moved.line}:${moved.column}` +
          ` (expected line ${expectedLine})`,
        ok: false,
      };
    }
  }
  const known = new Set(everySite(before).map((site) => site.id));
  const fillOf = new Map(after.holes.map((hole) => [hole.id, hole.fill]));
  const writtenByFill = (holeId: string): boolean => {
    for (let cur: string | undefined = holeId; cur !== undefined; cur = fillOf.get(cur)) {
      if (cur === holeSiteId) return true;
    }
    return false;
  };
  for (const site of everySite(after)) {
    if (known.has(site.id)) continue;
    const owner = holePrefixOf(site.id) ?? site.id;
    if (!writtenByFill(owner)) {
      return { detail: `site ${site.id} appeared outside the fill of ${holeSiteId}`, ok: false };
    }
  }
  return { ok: true };
}
