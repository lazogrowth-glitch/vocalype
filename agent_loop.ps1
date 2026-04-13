# ============================================================
# agent_loop.ps1 — Boucle d'amélioration ASR Parakeet V3
# Usage: .\agent_loop.ps1 [-MaxIterations 10] [-SkipBaseline]
# ============================================================

param(
    [int]$MaxIterations = 20,
    [switch]$SkipBaseline
)

$ErrorActionPreference = "Stop"
$REPO = "C:\developer\sas\vocalype"
$MODEL_PATH = "$env:APPDATA\com.vocalype.desktop\models\parakeet-tdt-0.6b-v3-int8"
$MANIFEST_LOCAL = "$REPO\src-tauri\evals\parakeet\dataset_manifest_combined_current.json"
$MANIFEST_FLEURS = "$REPO\src-tauri\evals\parakeet\external\fleurs_supported_400\dataset_manifest_external.json"
$REPORTS_DIR = "$REPO\src-tauri\evals\parakeet\reports"
$AIDER = "C:\Users\ziani\.local\bin\aider.exe"
$CARGO = "cargo"

# Baselines connues (Recovery V2)
$BASELINE_LOCAL_WER = 0.525
$BASELINE_FLEURS_WER = 8.009

if (-not (Test-Path $REPORTS_DIR)) {
    New-Item -ItemType Directory -Path $REPORTS_DIR | Out-Null
}

function Write-Step($msg) {
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host " $msg" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
}

function Run-Eval($manifest, $reportPath, $label) {
    Write-Step "Eval: $label"
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $report = "$REPORTS_DIR\$label-$timestamp.json"

    Push-Location $REPO
    try {
        & $CARGO run --manifest-path .\src-tauri\Cargo.toml --example parakeet_pipeline_eval -- `
            "$MODEL_PATH" "$manifest" parakeet_v3_multilingual "$report" 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ERREUR eval $label (code $LASTEXITCODE)" -ForegroundColor Red
            return $null
        }
    } finally {
        Pop-Location
    }

    # Extraire WER du rapport JSON
    if (Test-Path $report) {
        $data = Get-Content $report | ConvertFrom-Json
        $wer = $data.overall.wer_percent
        $cer = $data.overall.cer_percent
        $omissions = $data.overall.omission_rate
        $hallucinations = $data.overall.hallucination_rate
        Write-Host "  WER: $wer%  CER: $cer%  Omissions: $omissions%  Hallucinations: $hallucinations%" -ForegroundColor Yellow
        return @{ wer=$wer; cer=$cer; omissions=$omissions; hallucinations=$hallucinations; path=$report }
    }
    return $null
}

function Run-CargoCheck() {
    Write-Step "Cargo check + tests"
    Push-Location $REPO
    try {
        & $CARGO check --manifest-path .\src-tauri\Cargo.toml --example parakeet_pipeline_eval 2>&1
        if ($LASTEXITCODE -ne 0) { return $false }
        & $CARGO test --manifest-path .\src-tauri\Cargo.toml "runtime::parakeet_text::tests" --lib 2>&1
        if ($LASTEXITCODE -ne 0) { return $false }
        return $true
    } finally {
        Pop-Location
    }
}

function Run-GitDiff() {
    Push-Location $REPO
    $diff = & git diff --stat 2>&1
    $changes = & git diff --name-only 2>&1
    Pop-Location
    return @{ diff=$diff; files=$changes }
}

function Revert-Changes($files) {
    Write-Host "Revert des changements..." -ForegroundColor Red
    Push-Location $REPO
    foreach ($f in $files) {
        & git checkout -- $f 2>&1
    }
    Pop-Location
}

function Build-AgentPrompt($iteration, $localResult, $fleursResult, $previousAttempt) {
    $date = Get-Date -Format "yyyy-MM-dd HH:mm"
    $prevSection = if ($previousAttempt) { "## Tentative précédente (rejetée)\n$previousAttempt" } else { "" }

    return @"
Date: $date | Iteration: $iteration/$MaxIterations

Tu es un expert en ASR (Automatic Speech Recognition) améliorant le pipeline Parakeet V3 de Vocalype.
Consulte le fichier AGENT_MISSION.md pour le contexte complet, les règles, et les baselines.

## Résultats actuels

### Local 70 vocaux
- WER: $($localResult.wer)% (baseline: ${BASELINE_LOCAL_WER}%)
- CER: $($localResult.cer)%
- Omissions: $($localResult.omissions)%
- Hallucinations: $($localResult.hallucinations)%

### FLEURS 400 (EN/ES/FR/PT sans Hindi)
- WER: $($fleursResult.wer)% (baseline: ${BASELINE_FLEURS_WER}%)
- CER: $($fleursResult.cer)%
- Omissions: $($fleursResult.omissions)%
- Hallucinations: $($fleursResult.hallucinations)%

$prevSection

## Ta mission pour cette itération

Propose et implémente UNE seule amélioration ciblée qui pourrait réduire WER/CER/omissions/hallucinations.
Règles strictes:
1. NE PAS changer la taille de chunk globalement
2. NE PAS introduire Hindi
3. NE PAS faire git reset
4. Toute amélioration doit être conservative (ne pas casser ce qui marche)
5. Si tu ne vois pas d'amélioration sûre, écris "NO_CHANGE" sans toucher aux fichiers

Fichiers à modifier si pertinent:
- src-tauri/src/actions/transcribe.rs
- src-tauri/src/runtime/parakeet_text.rs
- src-tauri/src/runtime/parakeet_quality.rs

Implémente directement le changement dans le code.
"@
}

# ============================================================
# MAIN
# ============================================================

Write-Host @"

  ___  ____  ____     _
 / _ \/ ___||  _ \   | |    ___   ___  _ __
| | | \___ \| |_) |  | |   / _ \ / _ \| '_ \
| |_| |___) |  _ <   | |__| (_) | (_) | |_) |
 \___/|____/|_| \_\  |_____\___/ \___/| .__/
                                       |_|

Vocalype ASR Agent Loop — Parakeet V3 Improvement
"@ -ForegroundColor Magenta

Write-Host "Max iterations: $MaxIterations" -ForegroundColor Gray
Write-Host "Baselines: Local WER ${BASELINE_LOCAL_WER}% | FLEURS WER ${BASELINE_FLEURS_WER}%`n" -ForegroundColor Gray

# Eval baseline initiale
if (-not $SkipBaseline) {
    Write-Step "Eval baseline initiale"
    $baseLocal = Run-Eval $MANIFEST_LOCAL "baseline_local" "baseline-local70"
    $baseFleurs = Run-Eval $MANIFEST_FLEURS "baseline_fleurs" "baseline-fleurs400"

    if (-not $baseLocal -or -not $baseFleurs) {
        Write-Host "ERREUR: Impossible de lancer les evals baseline. Vérifier le modèle et les manifests." -ForegroundColor Red
        exit 1
    }

    $currentLocal = $baseLocal
    $currentFleurs = $baseFleurs
} else {
    Write-Host "Baseline skippée — utilisation des baselines hardcodées" -ForegroundColor Yellow
    $currentLocal = @{ wer=$BASELINE_LOCAL_WER; cer=1.443; omissions=0; hallucinations=0 }
    $currentFleurs = @{ wer=$BASELINE_FLEURS_WER; cer=5.523; omissions=6.728; hallucinations=6.353 }
}

$bestLocal = $currentLocal.wer
$bestFleurs = $currentFleurs.wer
$previousAttempt = $null
$improvements = 0

# ============================================================
# BOUCLE PRINCIPALE
# ============================================================
for ($i = 1; $i -le $MaxIterations; $i++) {
    Write-Step "ITERATION $i / $MaxIterations"
    Write-Host "Meilleur local WER: $bestLocal% | Meilleur FLEURS WER: $bestFleurs%" -ForegroundColor Green

    # Snapshot des fichiers avant modification
    $gitStatus = & git -C $REPO diff --name-only 2>&1

    # Construire le prompt
    $prompt = Build-AgentPrompt $i $currentLocal $currentFleurs $previousAttempt

    # Créer un fichier prompt temporaire
    $promptFile = "$REPO\agent_prompt_temp.txt"
    $prompt | Out-File -FilePath $promptFile -Encoding UTF8

    Write-Step "Lancement de l'agent Aider"
    Push-Location $REPO
    try {
        & $AIDER `
            --model ollama/qwen2.5-coder:7b-instruct-q8_0 `
            --no-auto-commits `
            --yes-always `
            --read AGENT_MISSION.md `
            --file src-tauri/src/actions/transcribe.rs `
            --file src-tauri/src/runtime/parakeet_text.rs `
            --file src-tauri/src/runtime/parakeet_quality.rs `
            --message-file agent_prompt_temp.txt `
            2>&1
    } finally {
        Pop-Location
    }

    Remove-Item $promptFile -Force -ErrorAction SilentlyContinue

    # Vérifier si l'agent a modifié des fichiers
    $newChanges = & git -C $REPO diff --name-only 2>&1
    $changedFiles = $newChanges | Where-Object { $_ -ne "" }

    if (-not $changedFiles -or ($changedFiles | Out-String).Contains("NO_CHANGE")) {
        Write-Host "Agent: aucune modification proposée." -ForegroundColor Yellow
        $previousAttempt = "Iteration $i: Agent n'a pas proposé de changement."
        continue
    }

    Write-Host "Fichiers modifiés: $($changedFiles -join ', ')" -ForegroundColor Cyan

    # Cargo check
    Write-Step "Validation compilation"
    $compileOk = Run-CargoCheck
    if (-not $compileOk) {
        Write-Host "COMPILATION ECHOUEE — Revert" -ForegroundColor Red
        Revert-Changes $changedFiles
        $previousAttempt = "Iteration $i: Changement rejeté — ne compile pas."
        continue
    }

    # Evals après changement
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $newLocal = Run-Eval $MANIFEST_LOCAL "local70" "iter$i-local70-$timestamp"
    $newFleurs = Run-Eval $MANIFEST_FLEURS "fleurs400" "iter$i-fleurs400-$timestamp"

    if (-not $newLocal -or -not $newFleurs) {
        Write-Host "ERREUR eval — Revert" -ForegroundColor Red
        Revert-Changes $changedFiles
        $previousAttempt = "Iteration $i: Eval a échoué."
        continue
    }

    # Décision: accepter ou rejeter
    $localImproved = $newLocal.wer -le ($currentLocal.wer + 0.1)    # tolérance 0.1%
    $fleursImproved = $newFleurs.wer -le ($currentFleurs.wer + 0.3)  # tolérance 0.3%
    $localBetter = $newLocal.wer -lt $currentLocal.wer
    $fleursBetter = $newFleurs.wer -lt $currentFleurs.wer

    Write-Host "`nComparaison:" -ForegroundColor White
    Write-Host "  Local 70:   $($currentLocal.wer)% -> $($newLocal.wer)%  $(if($localBetter){'✓ MIEUX'}elseif($localImproved){'~ OK'}else{'✗ RÉGRESSION'})" -ForegroundColor $(if($localBetter){'Green'}elseif($localImproved){'Yellow'}else{'Red'})
    Write-Host "  FLEURS 400: $($currentFleurs.wer)% -> $($newFleurs.wer)%  $(if($fleursBetter){'✓ MIEUX'}elseif($fleursImproved){'~ OK'}else{'✗ RÉGRESSION'})" -ForegroundColor $(if($fleursBetter){'Green'}elseif($fleursImproved){'Yellow'}else{'Red'})

    if ($localImproved -and $fleursImproved) {
        Write-Host "`nCHANGEMENT ACCEPTÉ" -ForegroundColor Green

        # Commit
        $commitMsg = "agent: iter$i — local WER $($newLocal.wer)% FLEURS WER $($newFleurs.wer)%"
        & git -C $REPO add -p 2>&1 | Out-Null
        Push-Location $REPO
        & git add src-tauri/src/actions/transcribe.rs src-tauri/src/runtime/parakeet_text.rs src-tauri/src/runtime/parakeet_quality.rs 2>&1 | Out-Null
        & git commit -m $commitMsg 2>&1 | Out-Null
        Pop-Location

        $currentLocal = $newLocal
        $currentFleurs = $newFleurs

        if ($newLocal.wer -lt $bestLocal) { $bestLocal = $newLocal.wer }
        if ($newFleurs.wer -lt $bestFleurs) { $bestFleurs = $newFleurs.wer }
        $improvements++
        $previousAttempt = $null

    } else {
        Write-Host "`nCHANGEMENT REJETÉ — Revert" -ForegroundColor Red
        $reason = ""
        if (-not $localImproved) { $reason += "Local 70 régresse ($($currentLocal.wer)% -> $($newLocal.wer)%). " }
        if (-not $fleursImproved) { $reason += "FLEURS régresse ($($currentFleurs.wer)% -> $($newFleurs.wer)%). " }
        Revert-Changes $changedFiles
        $previousAttempt = "Iteration $i rejetée: $reason"
    }

    # Résumé itération
    Write-Host "`n[Iter $i] Améliorations acceptées: $improvements | Best local: $bestLocal% | Best FLEURS: $bestFleurs%" -ForegroundColor Magenta
}

# ============================================================
# RÉSUMÉ FINAL
# ============================================================
Write-Step "RÉSUMÉ FINAL"
Write-Host "Iterations: $MaxIterations | Améliorations: $improvements" -ForegroundColor White
Write-Host "Baseline local WER:  ${BASELINE_LOCAL_WER}% -> $bestLocal% (delta: $([math]::Round($bestLocal - $BASELINE_LOCAL_WER, 3))%)" -ForegroundColor $(if($bestLocal -lt $BASELINE_LOCAL_WER){'Green'}else{'Yellow'})
Write-Host "Baseline FLEURS WER: ${BASELINE_FLEURS_WER}% -> $bestFleurs% (delta: $([math]::Round($bestFleurs - $BASELINE_FLEURS_WER, 3))%)" -ForegroundColor $(if($bestFleurs -lt $BASELINE_FLEURS_WER){'Green'}else{'Yellow'})
Write-Host "`nRapports dans: $REPORTS_DIR" -ForegroundColor Gray
