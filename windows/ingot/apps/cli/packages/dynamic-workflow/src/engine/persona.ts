// ============================================================
// ============================================================

import type { PersonaSpec } from "./types.js";

export function normalizePersona(
  name: string | undefined,
  persona: string | PersonaSpec | undefined,
): PersonaSpec {
  const base: PersonaSpec = {};
  if (typeof persona === "string") {
    base.system = persona;
  } else if (persona !== null && typeof persona === "object") {
    if (typeof persona.name === "string") base.name = persona.name;
    if (typeof persona.system === "string") base.system = persona.system;
    if (typeof persona.model === "string") base.model = persona.model;
  }
  if (base.name === undefined && name !== undefined) base.name = name;
  return base;
}

export function personaIdentity(persona: PersonaSpec): PersonaSpec {
  const { model: _model, ...identity } = persona;
  void _model;
  return identity;
}
