import { useEffect, useRef, useState } from "react";

export const PEN_MS = 24;
export const PEN_GAP_MS = 120;

export interface TypewriterState {
  
  visible: number;
  
  shown: readonly number[];
  
  idle: boolean;
}

interface PenState {
  visible: number;
  shown: number[];
}

const SILENT: TypewriterState = { idle: false, shown: [], visible: 0 };

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

function reconcile(
  state: PenState,
  names: readonly string[],
  previous: readonly string[],
): PenState {
  const visible = Math.min(state.visible, names.length);
  let changed = visible !== state.visible;
  const shown = state.shown.slice(0, visible).map((count, i) => {
    const next = Math.min(count, commonPrefix(previous[i] ?? "", names[i]!));
    if (next !== count) changed = true;
    return next;
  });
  return changed ? { shown, visible } : state;
}

function shownOf(state: PenState, names: readonly string[], reduced: boolean): readonly number[] {
  return reduced ? state.shown.map((_, i) => names[i]?.length ?? 0) : state.shown;
}

export function useTypewriter(names: readonly string[] | undefined): TypewriterState {
  const [state, setState] = useState<PenState>({ shown: [], visible: 0 });
  const key = names?.join("\u0000");
  const namesRef = useRef<readonly string[]>([]);
  const lastRef = useRef<readonly string[]>([]);
  if (names !== undefined) namesRef.current = names;

  useEffect(() => {
    if (key === undefined) return undefined;
    const current = namesRef.current;
    const previous = lastRef.current;
    lastRef.current = current;
    const pen = reconcile(state, current, previous);
    if (pen !== state) {
      setState(pen);
      return undefined;
    }
    const reduced = prefersReducedMotion();
    const at = pen.visible - 1;
    const target = at >= 0 ? current[at]! : undefined;
    const written = target === undefined ? 0 : (shownOf(pen, current, reduced)[at] ?? 0);
    if (target !== undefined && written < target.length) {
      const timer = setTimeout(() => {
        const shown = pen.shown.slice();
        shown[at] = written + 1;
        setState({ shown, visible: pen.visible });
      }, PEN_MS);
      return () => clearTimeout(timer);
    }
    if (current.length <= pen.visible) return undefined;
    const reveal = () => setState({ shown: [...pen.shown, 0], visible: pen.visible + 1 });
    if (target === undefined) {
      reveal();
      return undefined;
    }
    const timer = setTimeout(reveal, PEN_GAP_MS);
    return () => clearTimeout(timer);
  }, [key, state]);

  if (names === undefined) return SILENT;
  const shown = shownOf(state, names, prefersReducedMotion());
  const at = state.visible - 1;
  const idle = at >= 0 && state.visible === names.length && (shown[at] ?? 0) >= names[at]!.length;
  return { idle, shown, visible: state.visible };
}
