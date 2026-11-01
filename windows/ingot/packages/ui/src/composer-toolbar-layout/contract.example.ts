import type { ComposerToolbarLayoutContract } from "@/composer-toolbar-layout/contract.js";

export function exampleComposerToolbarLayout(
  contract: ComposerToolbarLayoutContract,
  root: HTMLElement,
): void {
  contract.fit(root);
}
