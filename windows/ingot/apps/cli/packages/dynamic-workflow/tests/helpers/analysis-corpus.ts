

import type { CompileDiagnostic } from "../../src/index.js";
import { FANOUT_ACTOR_NAME_CODE } from "../../src/analysis/actor-names.js";

export function corpusDiagnostics(diagnostics: CompileDiagnostic[]): CompileDiagnostic[] {
  return diagnostics.filter((d) => d.code !== FANOUT_ACTOR_NAME_CODE);
}
