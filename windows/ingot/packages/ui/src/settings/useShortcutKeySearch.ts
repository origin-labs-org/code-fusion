import { useCallback, useEffect, useState } from "react";
import { recordShortcutBinding } from "@/shortcuts/bindings.js";

export interface ShortcutKeySearch {
  
  armed: boolean;
  
  binding: string | null;
  
  toggle: () => void;
  
  disarm: () => void;
  
  clear: () => void;
}

export function useShortcutKeySearch(): ShortcutKeySearch {
  const [armed, setArmed] = useState(false);
  const [binding, setBinding] = useState<string | null>(null);

  useEffect(() => {
    if (!armed) {
      return;
    }
    function handleKeySearchKeydown(event: KeyboardEvent) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setArmed(false);
        return;
      }
      if (event.key === "Backspace") {
        setBinding(null);
        return;
      }
      const result = recordShortcutBinding(event);
      if (result.kind !== "binding") {
        return;
      }
      setBinding(result.binding);
      setArmed(false);
    }

    window.addEventListener("keydown", handleKeySearchKeydown, true);
    return () => {
      window.removeEventListener("keydown", handleKeySearchKeydown, true);
    };
  }, [armed]);

  const toggle = useCallback(() => setArmed((current) => !current), []);
  const disarm = useCallback(() => setArmed(false), []);
  const clear = useCallback(() => setBinding(null), []);

  return { armed, binding, toggle, disarm, clear };
}
