param(
    [string]$ModelDir = "",
    [string]$Manifest = "src-tauri/evals/parakeet/dataset_manifest.json",
    [string]$HypothesesDir = "src-tauri/evals/parakeet/hypotheses",
    [string]$ReportsDir = "src-tauri/evals/parakeet/reports",
    [string]$ModelId = "parakeet-tdt-0.6b-v3-multilingual",
    [ValidateSet("text", "pipeline", "all")]
    [string]$Mode = "all",
    [switch]$Help
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

function Show-Usage {
    Write-Host "Parakeet evaluation helper"
    Write-Host ""
    Write-Host "Usage:"
    Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/run-parakeet-evals.ps1 [-Mode text|pipeline|all] [-ModelDir <dir>] [-ModelId <id>]"
    Write-Host ""
    Write-Host "Examples:"
    Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/run-parakeet-evals.ps1 -Mode text"
    Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/run-parakeet-evals.ps1 -Mode pipeline -ModelDir C:\models\parakeet-v3"
    Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/run-parakeet-evals.ps1 -Mode all -ModelDir C:\models\parakeet-v3 -ModelId parakeet-tdt-0.6b-v3-multilingual"
}

if ($Help) {
    Show-Usage
    exit 0
}

$root = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $root $Manifest
$hypothesesPath = Join-Path $root $HypothesesDir
$reportsPath = Join-Path $root $ReportsDir
$srcTauriPath = Join-Path $root "src-tauri"

if (-not (Test-Path $manifestPath)) {
    throw "Manifest not found: $manifestPath"
}

New-Item -ItemType Directory -Force -Path $reportsPath | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

Push-Location $srcTauriPath
try {
    if ($Mode -in @("text", "all")) {
        $textReport = Join-Path $reportsPath "parakeet-text-eval-$timestamp.json"
        Write-Host "Running text hypothesis evaluation..."
        & cargo run --example parakeet_eval -- `
            $manifestPath `
            $hypothesesPath `
            $textReport `
            2>&1 | Write-Host
    }

    if ($Mode -in @("pipeline", "all")) {
        if ([string]::IsNullOrWhiteSpace($ModelDir)) {
            throw "ModelDir is required for pipeline mode."
        }

        $pipelineReport = Join-Path $reportsPath "parakeet-pipeline-eval-$timestamp.json"
        Write-Host "Running real pipeline evaluation..."
        & cargo run --example parakeet_pipeline_eval -- `
            $ModelDir `
            $manifestPath `
            $ModelId `
            $pipelineReport `
            2>&1 | Write-Host
    }
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "Done. Reports directory: $reportsPath"
