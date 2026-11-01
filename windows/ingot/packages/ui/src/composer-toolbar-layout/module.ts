
export const composerToolbarLayoutModule = {
  id: "composer-toolbar-layout",
  requires: [],
  provides: ["composer-toolbar-layout"],
  publicEntrypoints: ["../prompt-editor/useComposerToolbarFit.ts", "contract.ts"],
} as const;
