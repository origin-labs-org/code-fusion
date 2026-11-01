import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function readComputerUseProducer({ desktopPackageRoot }) {
  for (let dir = resolve(desktopPackageRoot); ; dir = dirname(dir)) {
    const manifestPath = resolve(dir, "node_modules", "@cf", "cf-cua", "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      return {
        installed: true,
        placeholder: manifest.cfCuaPlaceholder === true,
        manifest,
        packageRoot: dirname(manifestPath),
      };
    }
    if (dirname(dir) === dir) return { installed: false, placeholder: false };
  }
}

export function isRealComputerUseProducerInstalled({ desktopPackageRoot }) {
  const producer = readComputerUseProducer({ desktopPackageRoot });
  return producer.installed && !producer.placeholder;
}
