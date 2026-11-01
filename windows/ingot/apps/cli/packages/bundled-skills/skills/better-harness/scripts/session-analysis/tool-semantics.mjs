const EDIT_TOOL_NAMES = new Set([
  "createfile",
  "deletefile",
  "edit",
  "editfile",
  "multiedit",
  "notebookedit",
  "notebookwrite",
  "searchreplace",
  "write",
  "writefile",
]);

const FILE_PATH_TOOL_NAMES = new Set([
  ...EDIT_TOOL_NAMES,
  "notebookread",
  "read",
  "readfile",
]);

export function canonicalToolName(name) {
  return String(name ?? "")
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9]/gu, "")
    .toLowerCase();
}

export function isEditToolName(name) {
  return EDIT_TOOL_NAMES.has(canonicalToolName(name));
}

export function hasFilePathSemantics(name) {
  const canonical = canonicalToolName(name);
  return FILE_PATH_TOOL_NAMES.has(canonical)
    || /(?:read|edit|write).*file|file(?:read|edit|write)/u.test(canonical);
}
