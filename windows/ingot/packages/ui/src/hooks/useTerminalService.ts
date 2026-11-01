
import { useState, useEffect, useCallback, useRef } from "react";
import type { IDisposable } from "@origin-ai/cf-rpc";
import { logger } from "@/logger.js";
import { useServices } from "./useServices.js";

export function useTerminal(opts: {
  cols: number;
  rows: number;
  cwd?: string;
  onData?: (data: string) => void;
  onExit?: (code: number) => void;
}) {
  const { terminalService } = useServices();
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const disposablesRef = useRef<IDisposable[]>([]);

  const onDataRef = useRef(opts.onData);
  onDataRef.current = opts.onData;
  const onExitRef = useRef(opts.onExit);
  onExitRef.current = opts.onExit;

  useEffect(() => {
    let cancelled = false;
    let id: string | null = null;

    terminalService
      .create({ cols: opts.cols, rows: opts.rows, cwd: opts.cwd })
      .then(({ id: newId }) => {
        if (cancelled) {
          terminalService.dispose({ id: newId });
          return;
        }
        id = newId;
        setTerminalId(newId);

        const dataSub = terminalService.onDynamicData(newId)((data) => {
          onDataRef.current?.(data);
        });
        disposablesRef.current.push(dataSub);

        const exitSub = terminalService.onDynamicExit(newId)((code) => {
          onExitRef.current?.(code);
        });
        disposablesRef.current.push(exitSub);
      })
      .catch((error) => {
        if (cancelled) return;
        logger.error("[terminal] failed to create terminal", error);
      });

    return () => {
      cancelled = true;
      for (const d of disposablesRef.current) d.dispose();
      disposablesRef.current = [];
      if (id) terminalService.dispose({ id });
    };
  }, [terminalService, opts.cols, opts.rows, opts.cwd]);

  const write = useCallback(
    (data: string) => {
      if (terminalId) terminalService.write({ id: terminalId, data });
    },
    [terminalService, terminalId],
  );

  const resize = useCallback(
    (cols: number, rows: number) => {
      if (terminalId) terminalService.resize({ id: terminalId, cols, rows });
    },
    [terminalService, terminalId],
  );

  return { terminalId, write, resize };
}
