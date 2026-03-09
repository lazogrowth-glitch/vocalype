param(
    [string]$PrivateKeyPath = "$env:USERPROFILE\.tauri\vocaltype.key",
    [string]$PrivateKeyPassword = "",
    [switch]$SkipSigning,
    [switch]$Clean
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Get-Artifact {
    param([string]$PathPattern)
    Get-ChildItem -Path $PathPattern -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
}

Write-Step "Preparing release build"

if ($Clean) {
    Write-Step "Cleaning previous Tauri release artifacts"
    cargo clean --manifest-path src-tauri/Cargo.toml
}

if (-not $SkipSigning) {
    if (-not (Test-Path $PrivateKeyPath)) {
        throw "Signing key not found at '$PrivateKeyPath'. Use -PrivateKeyPath or -SkipSigning."
    }

    $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $PrivateKeyPath -Raw

    if ($PrivateKeyPassword) {
        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $PrivateKeyPassword
    } elseif ($env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
        # Keep any existing session password.
    } else {
        Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
    }
} else {
    Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
}

Write-Step "Running Tauri production build"
bun run tauri build

Write-Step "Collecting build artifacts"
$msi = Get-Artifact "src-tauri\target\release\bundle\msi\*.msi"
$nsis = Get-Artifact "src-tauri\target\release\bundle\nsis\*.exe"
$exe = Get-Artifact "src-tauri\target\release\*.exe"

if (-not $msi -and -not $nsis -and -not $exe) {
    throw "Build finished but no release artifacts were found."
}

Write-Host ""
Write-Host "Release artifacts:" -ForegroundColor Green

if ($exe) {
    Write-Host "  App EXE : $($exe.FullName)"
}
if ($msi) {
    Write-Host "  MSI     : $($msi.FullName)"
}
if ($nsis) {
    Write-Host "  NSIS    : $($nsis.FullName)"
}
