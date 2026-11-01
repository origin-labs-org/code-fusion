<#
  Launcher - lists parts, or starts/reports one.

  Reads arch/windows.json. Accepts a codename ("onyx") or an alias ("studio").
  Aliases: Lite -> Zingma, Pro -> Codeix, Studio -> Onyx, Max -> Ingot, Ultra -> Zenix CC.
  "#" means the alias seat is retired (Chromix, GSX-CLI).

  Usage:
    .\launch.ps1              # list parts + aliases
    .\launch.ps1 studio       # alias -> Onyx, starts CodeFusion.exe
    .\launch.ps1 max          # alias -> Ingot, starts pnpm dev:desktop
    .\launch.ps1 chromix      # codename: prints contents + status
#>
param([Parameter(Position = 0)][string]$Part)

$root = Split-Path -Parent $PSScriptRoot
$registry = Get-Content (Join-Path $root "arch\windows.json") -Raw | ConvertFrom-Json

if (-not $Part) {
  "Launcher - parts:"
  "{0,-10} {1,-8} {2,-22} {3,-8} {4}" -f "CODENAME", "ALIAS", "FOLDER", "STATUS", "CONTENTS"
  foreach ($p in $registry.parts) {
    $alias = if ($null -eq $p.alias) { "#" } else { $p.alias }
    "{0,-10} {1,-8} {2,-22} {3,-8} {4}" -f $p.codename, $alias, $p.folder, $p.status, $p.contents
  }
  ""
  "Aliases: " + (($registry.naming.ladder) -join " -> ") + "   (retired: " + (($registry.naming.retiredAliases) -join ", ") + ")"
  "Run: .\launch.ps1 <codename|alias>"
  exit 0
}

$entry = $registry.parts | Where-Object { $_.codename -ieq $Part } | Select-Object -First 1
if (-not $entry) {
  $codename = $registry.aliasResolve.PSObject.Properties[$Part]
  if ($codename) {
    $entry = $registry.parts | Where-Object { $_.codename -ieq $codename.Value } | Select-Object -First 1
    "alias '" + $Part + "' -> " + $entry.codename
  }
}
if (-not $entry) {
  "Unknown part or alias '" + $Part + "'. Known: " + (($registry.parts | ForEach-Object { $_.codename }) -join ", ")
  exit 1
}

$folder = Join-Path $root $entry.folder
switch ($entry.codename) {
  "Ingot" {
    if (-not (Test-Path (Join-Path $folder "package.json"))) { "Ingot has no package.json at " + $folder; exit 1 }
    Push-Location $folder
    try { & pnpm dev:desktop } finally { Pop-Location }
  }
  "Onyx" {
    $exe = Join-Path $folder "CodeFusion.exe"
    if (-not (Test-Path $exe)) { "Onyx has no CodeFusion.exe at " + $folder; exit 1 }
    Start-Process -FilePath $exe -WorkingDirectory $folder
    "Started Onyx (CodeFusion.exe)"
  }
  default {
    $entry.codename + " [" + $entry.status + "]"
    "  contents: " + $entry.contents
    "  folder:   " + $entry.folder
  }
}
