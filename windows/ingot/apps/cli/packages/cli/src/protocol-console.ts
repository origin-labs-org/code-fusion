import { Console } from "node:console";

export function installStderrConsoleBoundary(stderr: NodeJS.WritableStream): () => void {
  const originalConsole = globalThis.console;
  globalThis.console = new Console({ stdout: stderr, stderr });

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    globalThis.console = originalConsole;
  };
}
