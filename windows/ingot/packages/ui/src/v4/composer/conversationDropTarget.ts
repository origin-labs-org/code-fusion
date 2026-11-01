import type { DragEventHandler } from "react";

export interface ConversationDropTargetController {
  active: boolean;
  kind: "attachment" | "workspace" | null;
  onDragOver: DragEventHandler<HTMLElement>;
  onDragLeave: DragEventHandler<HTMLElement>;
  onDrop: DragEventHandler<HTMLElement>;
}
