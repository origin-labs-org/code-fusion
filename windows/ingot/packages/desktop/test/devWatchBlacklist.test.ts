import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const desktopPackageJsonPath = resolve(import.meta.dirname, "../package.json");
const desktopPackageJson = JSON.parse(readFileSync(desktopPackageJsonPath, "utf8")) as {
  scripts: Record<string, string | undefined>;
};

const generatedWatchBlacklist = [
  "mock-cdn/**",
  "bundled-agents/**",
  ".e2e-cache/**",
  ".e2e-artifacts/**",
  ".e2e-home-*/**",
  "dist-cua-helperu,
      );
    }
  });
});
