# Shipped Qoder application — source extraction

Input: `C:\Users\thaku\Workspaces\fusion\code-fusion\CF-Desktop`
Files inventoried: **4703** (803.3 MB)

| Class | Files | Size | Recoverable as source |
| --- | --- | --- | --- |
| Application JavaScript / JSON / CSS / HTML / TS / docs | 3778 | 266.5 MB | yes — plain text, readable and editable |
| Native / binary payloads (`.exe`, `.dll`, `.node`, `.pak`, `.wasm`) | 153 | 520.3 MB | no — machine code |
| Other assets (images, fonts, licenses) | 772 | — | assets only |

## What the executable actually is

The `.exe` is an Electron host: Chromium + Node.js + a thin bootstrap that loads
`resources/app`. Its machine code has no recoverable C++ source. Everything that decides
product behaviour — main process, workbench UI, agent window, extensions, prompts and
localisation tables — is JavaScript inside `resources/app` and is fully readable here.

## How modification works

1. Edit the file under `resources/app/...` (or the beautified copy, then copy back).
2. Keep the JSON valid; `product.json` drives the window title and app identity.
3. Launch `CodeFusion.exe` from this directory. Electron loads the edited resources; no
   recompile of the native host is involved (and none is possible without its source).

## Manifest

`MANIFEST.jsonl` lists every shipped file with size and SHA-256, so any edit can be proven
by diffing the manifest before/after.
