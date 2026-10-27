# MYIN local render install - Windows (owner decisions 2026-10-27). The OS shows this with the key:
#   powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((irm https://brandyaction-os.vercel.app/myin-local/install.ps1))) <key>"
# Installs node and ffmpeg with winget, puts the runner in %LOCALAPPDATA%\myin-local and a launcher on the desktop, and starts it.
# ASCII only on purpose: PowerShell may read a downloaded script in the system code page. The runner prints Korean itself.
param([string]$Key = "")
$ErrorActionPreference = "Stop"
$OsUrl = if ($env:OS_URL) { $env:OS_URL } else { "https://brandyaction-os.vercel.app" }
$HomeDir = Join-Path $env:LOCALAPPDATA "myin-local"
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Write-Host "winget (App Installer) is needed. Install 'App Installer' from the Microsoft Store, then paste the command again."; exit 1 }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") }
function Need($Command, $Id) {
  if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
    winget install -e --id $Id --accept-package-agreements --accept-source-agreements
    Refresh-Path
  }
}
Need node "OpenJS.NodeJS.LTS"
Need ffmpeg "Gyan.FFmpeg"
New-Item -ItemType Directory -Force -Path $HomeDir | Out-Null
$Runner = Join-Path $HomeDir "myin-local.mjs"
Invoke-WebRequest "$OsUrl/myin-local/myin-local.mjs" -OutFile $Runner -UseBasicParsing
$Launcher = Join-Path ([Environment]::GetFolderPath("Desktop")) "MYIN local render.cmd"
Set-Content -Path $Launcher -Encoding ASCII -Value "@echo off`r`nnode `"%LOCALAPPDATA%\myin-local\myin-local.mjs`"`r`npause"
Write-Host "Installed. Next time, double-click 'MYIN local render' on the desktop."
if ($Key) { node $Runner $Key } else { node $Runner }
