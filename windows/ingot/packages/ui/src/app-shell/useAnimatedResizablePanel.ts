import { useEffect, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

const PANEL_FLEX_GROW_TRANSITION_CLASSES = ["transition-[flex-grow]", "duration-200", "ease-out"];
const PANEL_FLEX_GROW_TRANSITION_FALLBACK_MS = 240;

function enablePanelFlexGrowTransition(panelElement: HTMLElement): () => void {
  panelElement.classList.add(...PANEL_FLEX_GROW_TRANSITION_CLASSES);

  let finished = false;
  let fallbackTimer = 0;

  const finish = () => {
    if (finished) {
      return;
    }
    finished = true;
    panelElement.removeEventListener("transitionend", handleTransitionEnd);
    if (fallbackTimer) {
      window.clearTimeout(fallbackTimer);
    }
    panelElement.classList.remove(...PANEL_FLEX_GROW_TRANSITION_CLASSES);
  };

  const handleTransitionEnd = (event: TransitionEvent) => {
    if (event.target === panelElement && event.propertyName === "flex-grow") {
      finish();
    }
  };

  panelElement.addEventListener("transitionend", handleTransitionEnd);
  fallbackTimer = window.setTimeout(finish, PANEL_FLEX_GROW_TRANSITION_FALLBACK_MS);

  return finish;
}

export function useAnimatedResizablePanel({
  open,
  alwaysMounted = false,
  expandedSize,
  rememberExpandedSize = false,
  resizeOnInitialVisibleMount = true,
}: {
  open: boolean;
  alwaysMounted?: boolean;
  expandedSize?: string;
  rememberExpandedSize?: boolean;
  resizeOnInitialVisibleMount?: boolean;
}) {
  const panelRef = useRef<PanelImperativeHandle | null>(null);
  const panelElementRef = useRef<HTMLDivElement | null>(null);
  const expandedSizeRef = useRef(expandedSize);
  const hasHandledVisibilityRef = useRef(false);
  const [isVisible, setIsVisible] = useState(open);

  useEffect(() => {
    expandedSizeRef.current = expandedSize;
  }, [expandedSize]);

  useEffect(() => {
    if (alwaysMounted) {
      setIsVisible(open);
      return;
    }

    if (open) {
      const rafId = window.requestAnimationFrame(() => {
        setIsVisible(true);
      });
      return () => {
        window.cancelAnimationFrame(rafId);
      };
    }

    setIsVisible(false);
  }, [alwaysMounted, open]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    const panelElement = panelElementRef.current;

    if (!hasHandledVisibilityRef.current) {
      hasHandledVisibilityRef.current = true;
      if (isVisible && !resizeOnInitialVisibleMount) {
        return;
      }
    }

    const cleanupTransition = panelElement
      ? enablePanelFlexGrowTransition(panelElement)
      : undefined;

    const rafId = window.requestAnimationFrame(() => {
      if (isVisible) {
        const nextExpandedSize = expandedSizeRef.current;
        if (nextExpandedSize) {
          panel.resize(nextExpandedSize);
          return;
        }
        panel.expand();
        return;
      }
      if (rememberExpandedSize) {
        const currentSize = panel.getSize().asPercentage;
        if (Number.isFinite(currentSize) && currentSize > 0) {
          expandedSizeRef.current = `${currentSize}%`;
        }
      }
      panel.collapse();
    });

    return () => {
      window.cancelAnimationFrame(rafId);
      cleanupTransition?.();
    };
  }, [isVisible, rememberExpandedSize, resizeOnInitialVisibleMount]);

  return {
    panelRef,
    panelElementRef,
    isVisible,
  };
}
