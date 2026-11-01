import type { EditorInfo, OpenInEditorRemoteTarget, RemoteTarget } from "@origin-ai/cf-shared";
import { sortInstalledEditorsForOpenWith } from "@/lib/openWithEditors.js";

const REMOTE_SSH_EDITOR_IDS = ["vscode", "vscode-insiders"];
const REMOTE_WSL_EDITOR_IDS = ["vscode", "vscode-insiders", "explorer"];

export type WorkspaceEditorSelectionKind = "preferred" | "fallback" | "empty" | "explicit";

export interface WorkspaceEditorSelectionState {
  availableEditors: EditorInfo[];
  selectedEditor: EditorInfo | null;
  selectionKind: Exclude<WorkspaceEditorSelectionKind, "explicit">;
}

export function resolveWorkspaceFileManagerEditor(
  availableEditors: EditorInfo[],
  remoteTarget?: RemoteTarget | OpenInEditorRemoteTarget,
): EditorInfo | null {
  if (remoteTarget?.kind !== "wsl") {
    return null;
  }
  return availableEditors.find((editor) => editor.id === "explorer") ?? null;
}

function filterEditorsByIdOrder(
  installedEditors: EditorInfo[],
  orderedIds: string[],
): EditorInfo[] {
  return orderedIds
    .map((id) => installedEditors.find((editor) => editor.id === id) ?? null)
    .filter((editor): editor is EditorInfo => editor !== null);
}

export function resolveWorkspaceEditorSelection({
  installedEditors,
  selectedEditorId,
  remoteTarget,
}: {
  installedEditors: EditorInfo[];
  selectedEditorId: string | null;
  remoteTarget?: RemoteTarget | OpenInEditorRemoteTarget;
}): WorkspaceEditorSelectionState {
  let availableEditors: EditorInfo[];

  if (remoteTarget?.kind === "ssh") {
    availableEditors = filterEditorsByIdOrder(installedEditors, REMOTE_SSH_EDITOR_IDS);
  } else if (remoteTarget?.kind === "wsl") {
    availableEditors = filterEditorsByIdOrder(installedEditors, REMOTE_WSL_EDITOR_IDS);
  } else if (remoteTarget) {
    availableEditors = [];
  } else {
    availableEditors = sortInstalledEditorsForOpenWith(installedEditors);
  }
  const preferredEditor =
    selectedEditorId === null
      ? null
      : availableEditors.find((editor) => editor.id === selectedEditorId) ?? null;
  const fallbackEditor = availableEditors[0] ?? null;

  if (preferredEditor) {
    return {
      availableEditors,
      selectedEditor: preferredEditor,
      selectionKind: "preferred",
    };
  }

  return {
    availableEditors,
    selectedEditor: fallbackEditor,
    selectionKind: fallbackEditor ? "fallback" : "empty",
  };
}

export function shouldPersistWorkspaceEditorSelection(
  selectionKind: WorkspaceEditorSelectionKind,
): boolean {
  return selectionKind === "explicit";
}
