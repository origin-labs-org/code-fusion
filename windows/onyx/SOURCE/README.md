# Shipped application source — extraction and proof

Everything below refers to the **installed Qoder 1.18.0 desktop application** at
`C:\Users\thaku\AppData\Local\Programs\Qoder`, copied to
`CF-Desktop\` and inventoried file by file.

## 1. What was extracted

| Class | Files | Size | Source available |
| --- | --- | --- | --- |
| Application JavaScript / JSON / CSS / HTML / TS / docs | **3 778** | 279.5 MB | yes — plain text |
| Native payloads (`.exe`, `.dll`, `.node`, `.pak`, `.wasm`) | **153** | 545.6 MB | no — machine code |
| Other assets (PNG/JPG/fonts/licenses) | 772 | 16.9 MB | assets only |
| **Total** | **4 703** | **842.3 MB** | |

`MANIFEST.jsonl` has exactly **4 703** lines — one per shipped file, with `path`, `bytes`
and `sha256`. Diff it before/after any edit to prove what changed.

## 2. Readable source (beautified)

The shipped bundles are minified. Formatted copies (oxfmt) live in `beautified/`:

| File | Original | Formatted | Lines |
| --- | --- | --- | --- |
| `out/main.js` | 1.4 MB | 2.2 MB | 60 265 |
| `out/cli.js` | 227 KB | 339 KB | 9 203 |
| `out/bootstrap-fork.js` | 30 KB | 38 KB | 1 158 |
| `out/lingma/agents-window/agents-window.desktop.main.js` | 44.3 MB | 62.3 MB | 1 979 591 |
| `out/vs/workbench/workbench.desktop.main.js` | 44.3 MB | 62.3 MB | 1 979 318 |
| `extensions/aicoding-agent/dist/extension.js` | 6.6 MB | 12.3 MB | 296 947 |

≈ 4.33 million readable lines in total. `node --check` passes on `beautified/out/main.js`
(exit 0), so the formatted files are valid JavaScript, not mangled text.

The edits are made against `resources/app/**` (the tree the executable actually loads);
`beautified/` is the reading copy.

## 3. The executable itself

- `CF-Desktop\CodeFusion.exe` is the **genuine Qoder binary**, renamed only.
- SHA-256 of the installed `Qoder.exe` and of `CodeFusion.exe`:
  `43c31ca5ec2b3c3cfdd9e6a721891b7cb0e17158dcf6fe37f685fe19ffdd4441` — identical.
- It is an Electron host (Chromium + Node.js + bootstrap). The C++/Chromium layer ships as
  machine code; no C++ source exists or can be recovered from it. Everything that decides
  product behaviour is JavaScript under `resources/app`, which is what section 2 lists.

## 4. Modifications applied so far

| # | File | Change | Proof |
| --- | --- | --- | --- |
| 1 | `resources/app/product.json` | `nameShort` / `nameLong` / `win32*` / `urlProtocol` / `win32AppUserModelId` → CodeFusion; `applicationName` → `codefusion`, `darwinBundleIdentifier` → `com.codefusion.ide` | JSON valid; values readable in the file |
| 2 | `resources/app/package.json` | `name: Qoder` → `codefusion` | JSON valid |
| 3 | `resources/app/resources/bin/x86_64_windows/Qoder.exe` | renamed to `CodeFusion.exe` (the Go local service the main process looks up by product name) | service now starts: `Starting go process: …\CodeFusion.exe start --workDir …\Roaming\CodeFusion\SharedClientCache`, health check OK |
| 4 | `resources/app/out/main.js` | window-title literal `"Quest Window"` → `"CodeFusion"` | sha256 `b011d056…7e68` → `5feb0fd6…79a3`, 1 literal replaced |

## 5. Relaunch proof

Launched `CF-Desktop\CodeFusion.exe` (the copied binary) and inspected the live process:

```
Get-Process CodeFusion | Where-Object { $_.MainWindowTitle } | Select Id,MainWindowTitle

   Id MainWindowTitle
   -- ---------------
19056 CodeFusion
```

Two top-level windows were reported by the desktop automation agent, **both titled
`CodeFusion`**: the workbench (menu bar File/Edit/Selection/View/Go/Run/Terminal/Help,
activity bar, EXPLORER, "NO FOLDER OPENED" with Open Folder / Clone Repository, welcome page,
status bar) and the separate Quest AI panel. No crash banner, no error dialog, no
"Local Service Resource Missing" notification.

Screenshots: `proof/codefusion-ide-window.png`, `proof/codefusion-quest-window.png`.

## 6. Not done (and why)

- The welcome page, menu labels and in-panel copy still say Qoder in places: those strings
  live inside the two 44 MB workbench bundles. They are next in line; each patch must be a
  literal-only replacement, verified with `node --check` and a relaunch.
- No offline recompile of the native host is possible: Qoder ships no C++/Chromium sources.
  Rebuilding only the JS resources is the supported path, and it is what was done.

## 7. Reproduce

```powershell
robocopy "C:\Users\thaku\AppData\Local\Programs\Qoder" "CF-Desktop" /E /MT:16
Rename-Item "CF-Desktop\Qoder.exe" "CodeFusion.exe"
node scripts\re\qoder-extract-source.mjs "CF-Desktop" "CF-Desktop\SOURCE"
node scripts\re\patch-cf-window-title.mjs "CF-Desktop\resources\app\out\main.js" "CodeFusion"
Start-Process "CF-Desktop\CodeFusion.exe"
```
