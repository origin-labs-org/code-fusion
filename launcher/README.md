# Launcher Desktop

The entry point. Name **Launcher Desktop**, window title **Launcher**. It has no product
logic: it reads `../arch/windows.json` and prints or starts what is actually there.

| File | Purpose |
| --- | --- |
| `index.html` | The launcher window itself (title `Launcher`): one card per part with alias, folder, contents and status. |
| `launch.ps1` | `.\launch.ps1` lists the parts; `.\launch.ps1 <codename\|alias>` starts or reports one. |
| `window.json` | Identity record plus the alias ladder and resolve map. |

## Usage

```powershell
.\launch.ps1            # list every part with alias, folder, status and contents
.\launch.ps1 ingot      # start the monorepo build (pnpm dev:desktop)
.\launch.ps1 onyx       # start CodeFusion.exe
.\launch.ps1 studio     # alias -> Onyx (same as above)
.\launch.ps1 plus       # alias -> Sonar (empty seat: reverse-engineered DeepSeek Harness)
.\launch.ps1 chromix    # prints contents + folder; no startable entry yet
```

## Current seats

| Alias | Part | Startable |
| --- | --- | --- |
| Max | Ingot | yes — `pnpm dev:desktop` |
| Studio | Onyx | yes — `CodeFusion.exe` |
| Pro | Codeix | no |
| Plus | Sonar | no — seat for the reverse-engineered DeepSeek Harness (DSH) |
| Lite | Zingma | no — seat for Qoder's native Quest/agents window |
| Ultra | Zenix CC | no — seat for native Claude Desktop |
| `#` | Chromix, GSX-CLI | no — alias retired, contents present |

Ladder: **Lite → Plus → Pro → Studio → Max → Ultra**. `Core` is retired (`#`).

## Deliberately absent

- No roles (no part is "main"; Ingot included).
- No hardcoded names: aliases and folders come from the registry.
- No pretending: a part without an entry prints its contents and folder instead.
