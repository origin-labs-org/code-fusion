import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const target = process.argv[2];
const readyMarkerNames = {
  main: ".main-build-ready",
  host: ".host-build-ready",
  preload: ".preload-build-ready",
  scheduler: ".scheduler-build-ready",
};

if (!Object.hasOwn(readyMarkerNames, target)) {
  throw new Error(`unknown ready marker target: ${target ?? "<empty>"}`);
}

const readyMarkerPath = resolve(root, "out", readyMarkerNames[target]);

mkdirSync(dirname(readyMarkerPath), { recursive: true });

writeFileSync(readyMarkerPath, `${new Date().toISOString()}\n`, "utf8");
