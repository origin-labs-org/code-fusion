import { useEffect, useLayoutEffect, useState } from "react";

export interface TimelineViewport {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
  
  scrolling: boolean;
}

const SCROLLING_MS = 800;
const EMPTY: TimelineViewport = { clientWidth: 0, scrollLeft: 0, scrollWidth: 0, scrolling: false };

function measure(element: HTMLElement): Omit<TimelineViewport, "scrolling"> {
  return {
    clientWidth: element.clientWidth,
    scrollLeft: element.scrollLeft,
    scrollWidth: element.scrollWidth,
  };
}

function merge(
  previous: TimelineViewport,
  measured: Omit<TimelineViewport, "scrolling">,
  scrolling = previous.scrolling,
): TimelineViewport {
  return previous.clientWidth === measured.clientWidth &&
    previous.scrollLeft === measured.scrollLeft &&
    previous.scrollWidth === measured.scrollWidth &&
    previous.scrolling === scrolling
    ? previous
    : { ...measured, scrolling };
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useTimelineViewport(
  
  element: HTMLElement | null,
  
  contentKey: number,
): TimelineViewport {
  const [viewport, setViewport] = useState<TimelineViewport>(EMPTY);

  useIsomorphicLayoutEffect(() => {
    if (element === null) return;
    setViewport((previous) => merge(previous, measure(element)));
  }, [element, contentKey]);

  useEffect(() => {
    if (element === null) return;
    let frame: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        setViewport((previous) => merge(previous, measure(element), true));
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = undefined;
          setViewport((previous) =>
            previous.scrolling ? { ...previous, scrolling: false } : previous,
          );
        }, SCROLLING_MS);
      });
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        setViewport((previous) => merge(previous, measure(element)));
      });
      observer.observe(element);
      const content = element.firstElementChild;
      if (content !== null) observer.observe(content);
    }
    return () => {
      element.removeEventListener("scroll", onScroll);
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (timer !== undefined) clearTimeout(timer);
      observer?.disconnect();
    };
  }, [element]);

  return viewport;
}
