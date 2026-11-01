import { useLayoutEffect, useRef, useState } from "react";
import { logger } from "@/logger.js";
import { ScrollFadeViewport } from "@/components/ui/scroll-fade-viewport.js";

export function ExecuteOutput({ text, running }: { text: string; running: boolean }) {
  const scroll = useRef<HTMLDivElement>(null);
  const previousTop = useRef(0);
  const hasStreamed = useRef(running);
  const [frozen, setFrozen] = useState<string | null>(null);
  const following = frozen === null;
  const display = frozen ?? text;

  useLayoutEffect(() => {
    if (running) hasStreamed.current = true;
    if (!hasStreamed.current || !following || !scroll.current) return;
    scroll.current.scrollTop = scroll.current.scrollHeight;
    previousTop.current = scroll.current.scrollTop;
  }, [display, following, running]);

  return (
    <ScrollFadeViewport
      ref={scroll}
      data-testid="bash-output-scroll"
      data-following={following}
      className="min-w-0 max-w-full max-h-[5lh] flex-none overflow-auto leading-5"
      tabIndex={0}
      onScroll={(event) => {
        const el = event.currentTarget;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 8;
        if (hasStreamed.current && following && el.scrollTop < previousTop.current && !atBottom) {
          setFrozen(display);
          logger.debug("Bash output following changed", { following: false });
        } else if (!following && atBottom) {
          setFrozen(null);
          logger.debug("Bash output following changed", { following: true });
        }
        previousTop.current = el.scrollTop;
      }}
    >
      <pre
        data-testid={running ? "bash-output-preview-full" : "bash-result-output"}
        className="whitespace-pre-wrap break-words font-mono text-ui-base leading-5 text-foreground-subtle"
      >
        {display}
      </pre>
    </ScrollFadeViewport>
  );
}
