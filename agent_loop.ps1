# ============================================================
# agent_loop.ps1 - Boucle amelioration ASR Parakeet V3 (v3)
# Usage: .\agent_loop.ps1 [-MaxIterations 40] [-SkipBaseline]
# ============================================================

param(
    [int]$MaxIterations = 15,
    [switch]$SkipBaseline
)

$ErrorActionPreference = "Continue"
$env:OLLAMA_API_BASE = "http://localhost:11434"
$env:PYTHONUTF8 = "1"
$REPO = "C:\developer\sas\vocalype"
$MODEL_PATH = "$env:APPDATA\com.vocalype.desktop\models\parakeet-tdt-0.6b-v3-int8"
$MANIFEST_LOCAL  = "$REPO\src-tauri\evals\parakeet\dataset_manifest_combined_current.json"
$MANIFEST_FLEURS = "$REPO\src-tauri\evals\parakeet\external\fleurs_supported_400\dataset_manifest_external.json"
$REPORTS_DIR     = "$REPO\src-tauri\evals\parakeet\reports"
$AIDER           = "C:\Users\ziani\.local\bin\aider.exe"

# Baselines mises a jour (2026-04-14 apres ameliorations Claude)
$BASELINE_LOCAL_WER  = 0.525
$BASELINE_FLEURS_WER = 7.145

# ---- Compactage contexte (evite overflow 32K tokens du modele 7B) ----
# Garde les N dernieres entrees en detail, compacte les plus anciennes en 1 ligne
$MAX_FULL_HISTORY   = 5    # nb d'entrees recentes gardees en detail dans le prompt
$compactedSummary   = ""   # accumule le resume des entrees compactees
$compactedIterCount = 0    # nb total d'iterations deja compactees

if (-not (Test-Path $REPORTS_DIR)) {
    New-Item -ItemType Directory -Path $REPORTS_DIR | Out-Null
}

# Historique des tentatives (taille bornee par le compactage)
$history = [System.Collections.Generic.List[string]]::new()

# Compacte les entrees history au-dela de MAX_FULL_HISTORY en 1 ligne resumee.
# Appele avant chaque construction de prompt pour garder le contexte borne.
function Invoke-HistoryCompaction() {
    if ($script:history.Count -le $script:MAX_FULL_HISTORY) { return }

    # Retirer les entrees les plus vieilles jusqu'a garder MAX_FULL_HISTORY
    $toCompact = [System.Collections.Generic.List[string]]::new()
    while ($script:history.Count -gt $script:MAX_FULL_HISTORY) {
        $toCompact.Add($script:history[0])
        $script:history.RemoveAt(0)
    }

    $nAccepted = ($toCompact | Where-Object { $_ -match "ACCEPTE" }).Count
    $nRejected = ($toCompact | Where-Object { $_ -match "REJETE" }).Count
    $nNoChange = ($toCompact | Where-Object { $_ -match "Aucune|NO_CHANGE" }).Count
    $script:compactedIterCount += $toCompact.Count

    # Extraire les WER si present (ex: "local 0.525%->0.520%")
    $werLine = ""
    $lastAccepted = $toCompact | Where-Object { $_ -match "ACCEPTE" } | Select-Object -Last 1
    if ($lastAccepted -and $lastAccepted -match "local ([\d.]+)%->") {
        $werLine = " | dernier WER local accepte: $($Matches[1])%"
    }

    $compactLine = "[Iters $($script:compactedIterCount - $toCompact.Count + 1)-$($script:compactedIterCount) resumees: $nAccepted ok / $nRejected ko / $nNoChange inchanges$werLine]"

    if ($script:compactedSummary) {
        $script:compactedSummary += "`n" + $compactLine
    } else {
        $script:compactedSummary = $compactLine
    }
}

function Write-Step($msg) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host " $msg" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
}

function Run-Eval($manifest, $label) {
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $report = "$REPORTS_DIR\$label-$timestamp.json"

    Push-Location $REPO
    # Piper via Write-Host pour que la sortie aille a l'ecran sans etre capturee par PowerShell
    cargo run --manifest-path .\src-tauri\Cargo.toml --example parakeet_pipeline_eval -- `
        "$MODEL_PATH" "$manifest" parakeet_v3_multilingual "$report" 2>&1 | ForEach-Object { Write-Host $_ }
    $evalExit = $LASTEXITCODE
    Pop-Location

    if ($evalExit -ne 0) {
        Write-Host "ERREUR eval $label (code $evalExit)" -ForegroundColor Red
        return $null
    }

    if (Test-Path $report) {
        return $report
    }
    return $null
}

function Get-StatsFromAnalysis($analysisOutput) {
    # Extraire le JSON de stats depuis la sortie Python
    $inStats = $false
    $jsonLine = ""
    foreach ($line in ($analysisOutput -split "`n")) {
        if ($line -match "JSON_STATS_START") { $inStats = $true; continue }
        if ($line -match "JSON_STATS_END") { break }
        if ($inStats) { $jsonLine += $line }
    }
    if ($jsonLine) {
        try { return $jsonLine | ConvertFrom-Json } catch { return $null }
    }
    return $null
}

function Run-Analysis($localReport, $fleursReport, $iteration) {
    $argsFile = "$REPO\agent_args_temp.txt"
    $output = @()
    try {
        $content = "$localReport`n$MANIFEST_LOCAL`n$iteration"
        if ($fleursReport) { $content += "`n$fleursReport`n$MANIFEST_FLEURS" }
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($argsFile, $content, $utf8NoBom)
        Push-Location $REPO
        $output = python agent_analyze_args.py 2>&1
        Pop-Location
    } finally {
        Remove-Item $argsFile -Force -ErrorAction SilentlyContinue
    }
    return ($output -join "`n")
}

function Run-CargoCheck() {
    Write-Step "Cargo check + tests unitaires"
    Push-Location $REPO
    cargo check --manifest-path .\src-tauri\Cargo.toml --example parakeet_pipeline_eval 2>&1
    $checkCode = $LASTEXITCODE
    if ($checkCode -ne 0) { Pop-Location; return $false }
    cargo test --manifest-path .\src-tauri\Cargo.toml "runtime::parakeet_text::tests" --lib 2>&1
    $testCode = $LASTEXITCODE
    Pop-Location
    return ($testCode -eq 0)
}

function Revert-Changes($files) {
    Write-Host "Revert automatique des changements..." -ForegroundColor Red
    Push-Location $REPO
    foreach ($f in $files) {
        if ($f -and $f.Trim()) {
            git checkout -- $f 2>&1 | Out-Null
        }
    }
    Pop-Location
}

function Build-Prompt($iteration, $analysis, $historyText) {

    # Taches assignees par iteration (rotation sur 5 taches)
    $tasks = @(
        "Ajoute ou ameliore la normalisation des NOMBRES: convertis les chiffres en mots pour les langues ES/FR/PT (ex: '3' -> 'tres'/'trois'/'tres'). EN: laisser les chiffres. Sois conservatif, ne touche qu'aux cas simples et non ambigus.",
        "Ameliore la DEDUPLICATION de mots entre chunks: quand deux chunks consecutifs se terminent/commencent par le meme mot, supprime le doublon. Regarde les exemples HYP dans l'analyse pour identifier les patterns.",
        "Ajoute des FILLERS manquants ou ameliore les existants: cherche dans les HYP des fillers non catches (euh, um, hmm, uh, eh, ah). Ajoute-les a la liste de nettoyage de fin de phrase.",
        "Ajoute des CORRECTIONS CIBLEES basees sur les exemples REF vs HYP de l'analyse: identifie les substitutions les plus frequentes et ajoute des regles de correction pour les cas non ambigus.",
        "Ameliore la PONCTUATION ou la CAPITALISATION: supprime les virgules/points superflus en debut/fin de chunk, corrige les majuscules inappropriees en milieu de phrase."
    )
    $taskIndex = ($iteration - 1) % $tasks.Count
    $assignedTask = $tasks[$taskIndex]

    if ($iteration -le 10) { $phase = "PHASE 1 -- fichier: parakeet_text.rs (corrections texte post-ASR)" }
    else                   { $phase = "PHASE 2 -- fichier: transcribe.rs (pipeline recovery, assemblage chunks)" }

    return @"
Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm') | Iteration: ${iteration}/$MaxIterations
Phase: $phase

Consulte AGENT_MISSION.md pour les regles completes et les baselines.

$analysis

## Historique des tentatives precedentes
$historyText

## TA TACHE OBLIGATOIRE pour l'iteration ${iteration}

$assignedTask

INSTRUCTIONS:
- Tu DOIS implementer cette tache dans $targetFile. Ce n'est pas optionnel.
- Si la tache est deja implementee: ameliore l'implementation existante (plus de cas, meilleure logique).
- Si vraiment impossible dans ce fichier: explique pourquoi en 1 ligne puis implemente la tache la plus similaire possible.
- NE PAS changer la taille de chunk globalement (prouve regressif).
- NE PAS introduire Hindi.
- NE PAS faire git reset ou revert.
- Changement CONSERVATIF: ne casse pas ce qui marche.

IMPORTANT: Modifie UNIQUEMENT $targetFile.
"@
}

# ============================================================
# MAIN
# ============================================================

Write-Host ""
Write-Host "  Vocalype ASR Agent Loop v3 - Parakeet V3" -ForegroundColor Magenta
Write-Host "  Max iterations  : $MaxIterations" -ForegroundColor Gray
Write-Host "  Baselines       : Local WER ${BASELINE_LOCAL_WER}% | FLEURS WER ${BASELINE_FLEURS_WER}%" -ForegroundColor Gray
Write-Host "  Context compaction : garder ${MAX_FULL_HISTORY} iters en detail, compacter le reste" -ForegroundColor Gray
Write-Host ""

# ============================================================
# BASELINE
# ============================================================
$currentLocalReport  = $null
$currentFleursReport = $null

if (-not $SkipBaseline) {
    Write-Step "Eval baseline initiale"

    Write-Step "Eval: baseline-local70"
    $currentLocalReport = Run-Eval $MANIFEST_LOCAL "baseline-local70"

    Write-Step "Eval: baseline-fleurs400"
    $currentFleursReport = Run-Eval $MANIFEST_FLEURS "baseline-fleurs400"

    if (-not $currentLocalReport -or -not $currentFleursReport) {
        Write-Host "ERREUR: Evals baseline ont echoue. Verifier modele et manifests." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "Baseline skippee - en attente du premier run pour avoir les rapports..." -ForegroundColor Yellow
    # Prendre les derniers rapports existants si disponibles
    $lastLocal = Get-ChildItem "$REPORTS_DIR\*local70*.json" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
    $lastFleurs = Get-ChildItem "$REPORTS_DIR\*fleurs400*.json" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
    if ($lastLocal)  { $currentLocalReport  = $lastLocal.FullName;  Write-Host "Rapport local  : $currentLocalReport"  -ForegroundColor Gray }
    if ($lastFleurs) { $currentFleursReport = $lastFleurs.FullName; Write-Host "Rapport FLEURS : $currentFleursReport" -ForegroundColor Gray }

    if (-not $currentLocalReport -or -not $currentFleursReport) {
        Write-Host "ERREUR: -SkipBaseline utilise mais aucun rapport existant. Relancer sans -SkipBaseline." -ForegroundColor Red
        exit 1
    }
}

# Analyse initiale
Write-Step "Analyse baseline"
$baselineAnalysis = Run-Analysis $currentLocalReport $currentFleursReport 0
$baseStats = Get-StatsFromAnalysis $baselineAnalysis

$bestLocalWer  = if ($baseStats -and $baseStats.local)  { $baseStats.local.wer }  else { $BASELINE_LOCAL_WER }
$bestFleursWer = if ($baseStats -and $baseStats.fleurs) { $baseStats.fleurs.wer } else { $BASELINE_FLEURS_WER }
$currentLocalWer  = $bestLocalWer
$currentFleursWer = $bestFleursWer

Write-Host $baselineAnalysis -ForegroundColor Gray
Write-Host ""
Write-Host "  WER Local  : $bestLocalWer%  (baseline: ${BASELINE_LOCAL_WER}%)" -ForegroundColor Yellow
Write-Host "  WER FLEURS : $bestFleursWer%  (baseline: ${BASELINE_FLEURS_WER}%)" -ForegroundColor Yellow

$improvements = 0

# ============================================================
# BOUCLE PRINCIPALE
# ============================================================
for ($i = 1; $i -le $MaxIterations; $i++) {

    Write-Step "ITERATION ${i} / $MaxIterations"
    Write-Host "  WER local: $currentLocalWer%  |  WER FLEURS: $currentFleursWer%  |  Ameliorations: $improvements" -ForegroundColor Green

    # Analyse detaillee des rapports actuels
    Write-Host "  Analyse des rapports en cours..." -ForegroundColor Gray
    $analysis = Run-Analysis $currentLocalReport $currentFleursReport $i

    # Historique: resume compacte des anciennes iters + detail des N dernieres
    $historyText = ""
    if ($compactedSummary) {
        $historyText += "=== Historique compacte (anciennes iterations) ===`n$compactedSummary`n`n"
    }
    $historyText += "=== Dernieres iterations (detail) ===`n"
    $historyText += if ($history.Count -eq 0) {
        "Aucune tentative precedente."
    } else {
        $history -join "`n"
    }

    # Compacter l'historique si trop long avant de construire le prompt
    Invoke-HistoryCompaction

    # Prompt pour l'agent
    $prompt = Build-Prompt $i $analysis $historyText
    $promptFile = "$REPO\agent_prompt_temp.txt"
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($promptFile, $prompt, $utf8NoBom)

    # Snapshot avant
    Push-Location $REPO
    $filesBefore = (git diff --name-only 2>$null) | Where-Object { $_ -match "^src-tauri/" }
    Pop-Location

    # parakeet_text.rs = corrections texte = impact direct sur WER
    # transcribe.rs = pipeline/recovery = impact sur omissions/hallucinations
    $targetFile = "src-tauri/src/runtime/parakeet_text.rs"     # iter 1-10
    if ($i -gt 10) { $targetFile = "src-tauri/src/actions/transcribe.rs" }  # iter 11+

    Write-Host "  Fichier cible: $targetFile" -ForegroundColor Gray

    # Creer .aiderignore temporaire pour empecher l'auto-ajout des gros fichiers
    $aiderIgnore = "$REPO\.aiderignore"
    $ignoreContent = "src-tauri/src/actions/transcribe.rs`nsrc-tauri/src/runtime/parakeet_quality.rs`nsrc-tauri/src/runtime/chunking.rs"
    if ($targetFile -match "transcribe") {
        $ignoreContent = "src-tauri/src/runtime/parakeet_quality.rs`nsrc-tauri/src/runtime/chunking.rs`nsrc-tauri/src/runtime/parakeet_text.rs"
    } elseif ($targetFile -match "parakeet_quality") {
        $ignoreContent = "src-tauri/src/actions/transcribe.rs`nsrc-tauri/src/runtime/chunking.rs`nsrc-tauri/src/runtime/parakeet_text.rs"
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($aiderIgnore, $ignoreContent, $utf8NoBom)

    # Lancer Aider
    Write-Step "Aider - iteration ${i}"
    Push-Location $REPO
    try {
        & $AIDER `
            --model ollama/qwen2.5-coder:7b-instruct-q8_0 `
            --edit-format diff `
            --no-auto-commits `
            --yes-always `
            --no-show-model-warnings `
            --no-browser `
            --no-gui `
            --map-tokens 0 `
            --read AGENT_MISSION.md `
            --file $targetFile `
            --message-file agent_prompt_temp.txt
    } finally {
        Pop-Location
        Remove-Item $aiderIgnore  -Force -ErrorAction SilentlyContinue
        Remove-Item $promptFile   -Force -ErrorAction SilentlyContinue
    }

    # Verifier modifications (filtrer les warnings git, garder seulement src-tauri/)
    Push-Location $REPO
    $filesAfter = (git diff --name-only 2>$null) | Where-Object { $_ -match "^src-tauri/" }
    Pop-Location
    $changedFiles = $filesAfter | Where-Object { $filesBefore -notcontains $_ }

    if (-not $changedFiles -or ($changedFiles.Count -eq 0)) {
        $msg = "Iter ${i}: Aucune modification (NO_CHANGE ou rien propose)."
        Write-Host "  $msg" -ForegroundColor Yellow
        $history.Add($msg)
        continue
    }

    Write-Host "  Fichiers modifies: $($changedFiles -join ', ')" -ForegroundColor Cyan

    # Cargo check
    $compileOk = Run-CargoCheck
    if (-not $compileOk) {
        $msg = "Iter ${i}: REJETE - ne compile pas. Fichiers: $($changedFiles -join ', ')"
        Write-Host "  $msg" -ForegroundColor Red
        $history.Add($msg)
        Revert-Changes $changedFiles
        continue
    }

    # Evals apres changement
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

    Write-Step "Eval local70 - iter ${i}"
    $newLocalReport = Run-Eval $MANIFEST_LOCAL "iter${i}-local70-$timestamp"

    Write-Step "Eval fleurs400 - iter ${i}"
    $newFleursReport = Run-Eval $MANIFEST_FLEURS "iter${i}-fleurs400-$timestamp"

    if (-not $newLocalReport -or -not $newFleursReport) {
        $msg = "Iter ${i}: REJETE - eval a echoue."
        Write-Host "  $msg" -ForegroundColor Red
        $history.Add($msg)
        Revert-Changes $changedFiles
        continue
    }

    # Analyse resultats
    $newAnalysis = Run-Analysis $newLocalReport $newFleursReport $i
    $newStats = Get-StatsFromAnalysis $newAnalysis

    $newLocalWer  = if ($newStats -and $newStats.local)  { $newStats.local.wer }  else { 999 }
    $newFleursWer = if ($newStats -and $newStats.fleurs) { $newStats.fleurs.wer } else { 999 }

    # Decision
    $localOk  = $newLocalWer  -le ($currentLocalWer  + 0.1)
    $fleursOk = $newFleursWer -le ($currentFleursWer + 0.3)
    $localDelta  = [math]::Round($newLocalWer  - $currentLocalWer,  3)
    $fleursDelta = [math]::Round($newFleursWer - $currentFleursWer, 3)

    Write-Host ""
    Write-Host "  Resultats:" -ForegroundColor White
    $lc = if ($newLocalWer  -lt $currentLocalWer)  { 'Green' } elseif ($localOk)  { 'Yellow' } else { 'Red' }
    $fc = if ($newFleursWer -lt $currentFleursWer) { 'Green' } elseif ($fleursOk) { 'Yellow' } else { 'Red' }
    Write-Host "    Local  70 : $currentLocalWer%  ->  $newLocalWer%   (delta: $localDelta%)"  -ForegroundColor $lc
    Write-Host "    FLEURS 400: $currentFleursWer% ->  $newFleursWer%  (delta: $fleursDelta%)" -ForegroundColor $fc

    if ($localOk -and $fleursOk) {
        Write-Host ""
        Write-Host "  >>> CHANGEMENT ACCEPTE <<<" -ForegroundColor Green

        Push-Location $REPO
        $commitMsg = "agent iter${i}: local=$newLocalWer% fleurs=$newFleursWer% files=$($changedFiles -join ',')"
        foreach ($cf in $changedFiles) { git add $cf 2>&1 | Out-Null }
        git commit -m $commitMsg 2>&1 | Out-Null
        Pop-Location

        $msg = "Iter ${i}: ACCEPTE - local $currentLocalWer%->$newLocalWer% FLEURS $currentFleursWer%->$newFleursWer%"
        $history.Add($msg)

        $currentLocalReport  = $newLocalReport
        $currentFleursReport = $newFleursReport
        $currentLocalWer     = $newLocalWer
        $currentFleursWer    = $newFleursWer

        if ($newLocalWer  -lt $bestLocalWer)  { $bestLocalWer  = $newLocalWer  }
        if ($newFleursWer -lt $bestFleursWer) { $bestFleursWer = $newFleursWer }
        $improvements++

    } else {
        Write-Host ""
        Write-Host "  >>> CHANGEMENT REJETE <<<" -ForegroundColor Red
        $reason = ""
        if (-not $localOk)  { $reason += "Local regresse ($localDelta%). "  }
        if (-not $fleursOk) { $reason += "FLEURS regresse ($fleursDelta%). " }
        $msg = "Iter ${i}: REJETE - $reason"
        $history.Add($msg)
        Revert-Changes $changedFiles
    }

    Write-Host ""
    Write-Host "  [Iter ${i}] Ameliorations: $improvements | Best local: $bestLocalWer% | Best FLEURS: $bestFleursWer%" -ForegroundColor Magenta
}

# ============================================================
# RESUME FINAL
# ============================================================
Write-Step "RESUME FINAL"

$deltaLocal  = [math]::Round($bestLocalWer  - $BASELINE_LOCAL_WER,  3)
$deltaFleurs = [math]::Round($bestFleursWer - $BASELINE_FLEURS_WER, 3)

Write-Host ""
Write-Host "  Iterations       : $MaxIterations" -ForegroundColor White
Write-Host "  Ameliorations    : $improvements" -ForegroundColor White
Write-Host ""

$cl = if ($bestLocalWer  -lt $BASELINE_LOCAL_WER)  { 'Green' } else { 'Yellow' }
$cf = if ($bestFleursWer -lt $BASELINE_FLEURS_WER) { 'Green' } else { 'Yellow' }
Write-Host "  Local  70  : ${BASELINE_LOCAL_WER}% -> $bestLocalWer%   (delta: $deltaLocal%)"  -ForegroundColor $cl
Write-Host "  FLEURS 400 : ${BASELINE_FLEURS_WER}% -> $bestFleursWer%  (delta: $deltaFleurs%)" -ForegroundColor $cf
Write-Host ""
Write-Host "  Historique des tentatives:" -ForegroundColor Gray
foreach ($h in $history) { Write-Host "    $h" -ForegroundColor Gray }
Write-Host ""
Write-Host "  Rapports : $REPORTS_DIR" -ForegroundColor Gray
Write-Host "  Commits  : git log --oneline -$MaxIterations" -ForegroundColor Gray
