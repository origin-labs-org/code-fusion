export type InterfaceMode = "office" | "coding";

export const INTERFACE_MODE_STORAGE_KEY = "cf-interface-mode";

export function normalizeInterfaceMode(value: unknown): InterfaceMode {
  return value === "office" || value === "general" || value === "concise" ? "office" : "coding";
}
