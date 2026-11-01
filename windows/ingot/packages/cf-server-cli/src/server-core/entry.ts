import { runServerCore } from "./core.js";

const generation = Number(process.argv[2] ?? 0);
void runServerCore(generation).catch((error: unknown) => {
  const exit = (): void => process.exit(1);
  if (typeof process.send !== "function" || process.connected === false) {
    exit();
    return;
  }
  try {
    process.send(
      { type: "fatal", message: error instanceof Error ? error.message : String(error) },
      exit,
    );
  } catch {
    exit();
  }
});
