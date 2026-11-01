import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { TID_V4_SPLIT_DIVIDER } from "@origin-ai/cf-shared/test-ids";
import { cn } from "@/components/lib/utils.js";
import { clampSplitRatio, type SplitDirection } from "@/v4/paneLayoutTree.js";
import { SPLIT_VAR_PREFIX } from "@/v4/workbenchLayout.js";

interface SplitDividerDragState {
  pointerId: number;
  
  regionPx: number;
  startClient: number;
  startRatio: number;
  latestClient: number;
  rafId: number | null;
}

export interface WorkbenchSplitDividerProps {
  containerRef: RefObject<HTMLDivElement | null>;
  splitId: string;
  direction: SplitDirection;
  
  ratio: number;
  
  regionFraction: number;
  style: CSSProperties;
  onCommitRatio: (splitId: string, ratio: number) => void;
}

export const WorkbenchSplitDivider = memo(function WorkbenchSplitDivider({
  containerRef,
  splitId,
  direction,
  ratio,
  regionFraction,
  style,
  onCommitRatio,
}: WorkbenchSplitDividerProps) {
  const dragRef = useRef<SplitDividerDragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const isRow = direction === "row";

  const ratioFromDrag = useCallback((drag: SplitDividerDragState): number => {
    if (drag.regionPx <= 0) {
      return drag.startRatio;
    }
    return clampSplitRatio(
      drag.startRatio + (drag.latestClient - drag.startClient) / drag.regionPx,
    );
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 && event.pointerType === "mouse") {
        return;
      }
      const container = containerRef.current;
      if (!container) {
        return;
      }
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
      }
      const containerRect = container.getBoundingClientRect();
      const client = isRow ? event.clientX : event.clientY;
      dragRef.current = {
        pointerId: event.pointerId,
        regionPx:
          (isRow ? containerRect.width : containerRect.height) * regionFraction,
        startClient: client,
        startRatio: ratio,
        latestClient: client,
        rafId: null,
      };
      setDragging(true);
    },
    [containerRef, isRow, ratio, regionFraction],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }
      drag.latestClient = isRow ? event.clientX : event.clientY;
      if (drag.rafId !== null) {
        return;
      }
      drag.rafId = requestAnimationFrame(() => {
        drag.rafId = null;
        containerRef.current?.style.setProperty(
          `${SPLIT_VAR_PREFIX}${splitId}`,
          String(ratioFromDrag(drag)),
        );
      });
    },
    [containerRef, isRow, ratioFromDrag, splitId],
  );

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }
      if (drag.rafId !== null) {
        cancelAnimationFrame(drag.rafId);
        drag.rafId = null;
      }
      drag.latestClient = isRow ? event.clientX : event.clientY;
      const finalRatio = ratioFromDrag(drag);
      containerRef.current?.style.setProperty(
        `${SPLIT_VAR_PREFIX}${splitId}`,
        String(finalRatio),
      );
      dragRef.current = null;
      setDragging(false);
      onCommitRatio(splitId, finalRatio);
    },
    [containerRef, isRow, onCommitRatio, ratioFromDrag, splitId],
  );

  useEffect(
    () => () => {
      const drag = dragRef.current;
      if (drag?.rafId != null) {
        cancelAnimationFrame(drag.rafId);
      }
      dragRef.current = null;
    },
    [],
  );

  return (
    <div
      data-testid={TID_V4_SPLIT_DIVIDER}
      data-split-id={splitId}
      role="separator"
      aria-orientation={isRow ? "vertical" : "horizontal"}
      data-dragging={dragging ? "true" : "false"}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={style}
      className={cn(
        "group absolute z-10 touch-none select-none",
        isRow ? "cursor-col-resize" : "cursor-row-resize",
      )}
    >
      <div
        className={cn(
          "pointer-events-none transition-colors",
          isRow ? "mx-auto h-full w-px" : "my-auto h-px w-full",
          dragging
            ? "bg-[var(--color-brand)]"
            : "bg-[var(--color-border)] group-hover:bg-[var(--color-brand)]",
        )}
      />
    </div>
  );
});
