import { readFileSync, writeFileSync } from "node:fs";

export function rewriteFormalSpecImports(specPath) {
  const original = readFileSync(specPath, "utf8");
  const rewritten = original
    .replaceAll("../../../helpers/", "../helpers/")
    .replaceAll("../../../pages/", "../pages/")
    .replaceAll("../../../fixtures/", "../fixtures/");
  if (rewritten !== original) {
    writeFileSync(specPath, rewritten, "utf8");
  }
}
