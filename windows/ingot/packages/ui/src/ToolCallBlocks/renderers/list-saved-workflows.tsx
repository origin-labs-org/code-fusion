import { Library } from "lucide-react";
import type { ToolCallBlockRenderContext } from "@/ToolCallBlocks/fileSummaryTypes.js";
import { FallbackToolCallBlock } from "@/ToolCallBlocks/renderers/fallback.js";
import { ListSavedWorkflowsPresentation } from "@/ToolCallBlocks/renderers/list-saved-workflows-presentation.js";
export { readListSavedWorkflowsResult } from "@/ToolCallBlocks/renderers/list-saved-workflows-presentation.js";

const ICON = <Library className="size-4 shrink-0 text-foreground-subtle" />;

export function ListSavedWorkflowsToolCallBlock(context: ToolCallBlockRenderContext) {
  return (
    <ListSavedWorkflowsPresentation
      {...context}
      fallback={<FallbackToolCallBlock {...context} iconOverride={ICON} />}
    />
  );
}
