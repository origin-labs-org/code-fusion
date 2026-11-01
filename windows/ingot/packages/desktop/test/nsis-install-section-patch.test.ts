import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  PATCH_MARKER,
  patchNsisInstallSectionFile,
  patchNsisInstallSectionSource,
  restoreNsisInstallSectionFileSync,
} from "../scripts/patch-nsis-install-section.mjs";

function createInstallSectionFixture(eol = "\r\n") {
  return [
    "InitPluginsDir",
    "",
    "${IfNot} ${Silent}",
    "  SetDetailsPrint none",
    "${endif}",
    "",
    "!insertmacro uninstallOldVersion SHELL_CONTEXT",
    "!insertmacro handleUninstallResult SHELL_CONTEXT",
    "",
    '${if} $installMode == "all"',
    "  !insertmacro uninstallOldVersion HKEY_CURRENT_USER",
    "  !insertmacro handleUninstallResult HKEY_CURRENT_USER",
    "${endIf}",
    "",
    "SetOutPath $INSTDIR",
    "",
    "!insertmacro installApplicationFiles",
    "!insertmacro registryAddInstallInfo",
    "!insertmacro addStartMenuLink $keepShortcuts",
    "!insertmacro addDesktopLink $keepShortcuts",
  ].join(eol);
}

describe("NSIS installSection template patch", () => {
  it("In current real template accessible stage, file-level repeated calls are idempotent and can restore original bytes", async () => {
    const require = createRequire(import.meta.url);
    const source = await readFile(
      join(
        dirname(require.resolve("app-builder-lib/package.json")),
        "templates/nsis/installSection.nsh",
      ),
      "utf8",
    );
    const root = await mkdtemp(join(tmpdir(), "cf-nsis-template-"));
    const path = join(root, "installSection.nsh");
    try {
      await writeFile(path, source);
      const first = await patchNsisInstallSectionFile(path);
      expect(first.changed).toBe(true);
      expect(first.originalSource).toBe(source);
      const patched = await readFile(path, "utf8");
      const sequence = [
        "!insertmacro customInstallSectionStarted",
        "!insertmacro customInstallCleanupStarted",
        "!insertmacro uninstallOldVersion SHELL_CONTEXT",
        "!insertmacro uninstallOldVersion HKEY_CURRENT_USER",
        "!insertmacro customInstallCleanupCompleted",
        "!insertmacro customInstallExtractStarted",
        "!insertmacro installApplicationFiles",
        "!insertmacro customInstallExtractCompleted",
        "!insertmacro customInstallShortcutsStarted",
        "!insertmacro addStartMenuLink",
        "!insertmacro customInstallShortcutsCompleted",
      ].map((marker) => patched.indexOf(marker));
      expect(
        sequence.every((index, offset) => index >= 0 && (!offset || index > sequence[offset - 1]!)),
      ).toBe(true);
      expect(await patchNsisInstallSectionFile(path)).toEqual({
        changed: false,
        originalSource: null,
      });
      restoreNsisInstallSectionFileSync({ filePath: path, originalSource: first.originalSource });
      expect(await readFile(path, "utf8")).toBe(source);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("opens file details and inserts the install phases without changing CRLF", () => {
    const source = createInstallSectionFixture();
    const patched = patchNsisInstallSectionSource(source);

    expect(patched).toContain(PATCH_MARKER.replaceAll("\n", "\r\n"));
    expect(patched).toContain("  SetDetailsPrint listonly\r\n");
    expect(patched).toContain("!insertmacro customInstallExtractStarted\r\n");
    expect(patched).toContain("!insertmacro customInstallExtractCompleted\r\n");
    expect(patched).toContain("!insertmacro customInstallShortcutsStarted\r\n");
    expect(patched).toContain("!insertmacro customInstallShortcutsCompleted\r\n");
    expect(patched).not.toContain("SetDetailsPrint none");
    expect(patchNsisInstallSectionSource(patched)).toBe(patched);
  });

  it("Should fail immediately on template structure changes instead of silently generating installer missing diagnostics", () => {
    expect(() => patchNsisInstallSectionSource("InitPluginsDir\n")).toThrow(
      "electron-builder installSection.nsh 缺少预期锚点",
    );
  });
});
