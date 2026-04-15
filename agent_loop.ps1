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

$TASK_LIST_FILE = "$REPO\src-tauri\evals\parakeet\ROBOT_TASK_LIST.md"

# Lit la prochaine tache non faite dans ROBOT_TASK_LIST.md
# Retourne un objet avec .id, .title, .body, .lineIndex
function Get-NextTask() {
    if (-not (Test-Path $TASK_LIST_FILE)) {
        return $null
    }
    $lines = Get-Content $TASK_LIST_FILE -Encoding UTF8
    $inTask = $false
    $taskId = ""
    $taskTitle = ""
    $taskBody = [System.Collections.Generic.List[string]]::new()
    $startLine = -1

    for ($li = 0; $li -lt $lines.Count; $li++) {
        $line = $lines[$li]

        # Stop collecting body when we hit any header (after already finding the task)
        if ($inTask -and $line -match "^#{1,3}\s+") {
            break
        }

        # Detect task header: "### A01 [ ] Title" — only if we haven't found one yet
        if (-not $inTask -and $line -match "^###\s+([\w\d]+)\s+\[ \]\s+(.+)$") {
            $taskId    = $Matches[1]
            $taskTitle = $Matches[2].Trim()
            $startLine = $li
            $inTask    = $true
            $taskBody.Clear()
            continue
        }

        if ($inTask) {
            $taskBody.Add($line)
        }
    }

    if ($taskId -eq "") { return $null }

    return [PSCustomObject]@{
        Id        = $taskId
        Title     = $taskTitle
        Body      = ($taskBody -join "`n").Trim()
        LineIndex = $startLine
    }
}

# Marque la tache courante comme DONE ou REJECTED dans la liste
function Set-TaskStatus($taskId, $status) {
    # status: "DONE" -> "[DONE v]", "REJECTED" -> "[REJECTED x]", "SKIPPED" -> "[SKIPPED -]"
    $marker = switch ($status) {
        "DONE"     { "[DONE v]" }
        "REJECTED" { "[REJECTED x]" }
        "SKIPPED"  { "[SKIPPED -]" }
        default    { "[DONE v]" }
    }
    $content = Get-Content $TASK_LIST_FILE -Raw -Encoding UTF8
    # Replace "### ID [ ]" with "### ID MARKER"
    $content = $content -replace "(?m)^(###\s+$([regex]::Escape($taskId))\s+)\[ \]", "`${1}$marker"
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($TASK_LIST_FILE, $content, $utf8NoBom)
}

function Build-Prompt($iteration, $analysis, $historyText, $task) {

    # Determine target file from task group
    $targetFileForTask = "src-tauri/src/runtime/parakeet_text.rs"
    if ($task -and $task.Id -match "^H") {
        $targetFileForTask = "src-tauri/src/actions/transcribe.rs"
    }

    $taskSection = if ($task) {
        $body = $task.Body

        # Extract first regex pattern from task body: r"pattern"
        $regexMatch = [regex]::Match($body, 'r\"([^\"]+)\"')
        $pattern = if ($regexMatch.Success) { $regexMatch.Groups[1].Value } else { "VOIR_TACHE" }

        # Extract replacement: text after the arrow symbol (-> or the unicode arrow)
        $replMatch = [regex]::Match($body, '(?:->|[=\-]>|`"([^`"]+)`"[^`"]*`"([^`"]+)`")')
        # Simpler: grab the quoted string after the last arrow
        $replMatch2 = [regex]::Match($body, '"([^"]+)"\s*$', [System.Text.RegularExpressions.RegexOptions]::Multiline)
        $replacement = if ($replMatch2.Success) { $replMatch2.Groups[1].Value.Trim() } else { "VOIR_TACHE" }

        # Determine target function
        $funcName = "normalize_parakeet_english_artifacts"
        if ($body -match "french_artifacts|FR branch") { $funcName = "normalize_parakeet_french_artifacts" }
        if ($body -match "ES branch") { $funcName = "finalize_parakeet_text, ES branch" }
        if ($body -match "PT branch") { $funcName = "finalize_parakeet_text, PT branch" }

        # Static var name from task id
        $staticName = ($task.Id -replace '[^A-Za-z0-9]', '_').ToUpper() + "_PATTERN"

        # Build the two Rust snippets as plain strings (no heredoc to avoid interpolation issues)
        $rustStatic = "static " + $staticName + ": Lazy<Regex> = Lazy::new(|| Regex::new(r`"" + $pattern + "`").unwrap());"
        $rustApply  = "    normalized = " + $staticName + ".replace_all(" + [char]0x26 + "normalized, `"" + $replacement + "`").to_string();"

        $lines = @(
            "## TACHE ASSIGNEE: $($task.Id) -- $($task.Title)",
            "",
            $body,
            "",
            "------",
            "## EXACTEMENT CE QUE TU DOIS FAIRE:",
            "",
            "ETAPE 1 - Ajoute dans la section des statics (apres le dernier static ... PATTERN):",
            $rustStatic,
            "",
            "ETAPE 2 - Ajoute dans la fonction [$funcName], apres la ligne [let mut normalized =]:",
            $rustApply,
            "",
            "REGLES: Fais UNIQUEMENT ces deux ajouts. Rien d'autre.",
            "NE PAS changer chunk size. NE PAS introduire Hindi."
        )
        $lines -join "`n"
    } else {
        "TOUTES LES TACHES SONT COMPLETES."
    }

    return @"
Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm') | Iteration: ${iteration}/$MaxIterations

Consulte AGENT_MISSION.md pour les regles completes et les baselines.
Le fichier cible est: $targetFileForTask

$analysis

## Historique des tentatives precedentes
$historyText

$taskSection

RAPPEL: Modifie UNIQUEMENT $targetFileForTask. Une seule tache par iteration. Ne pas bundler.
"@
}


# Expose targetFile pour la boucle principale (sera override par la tache)
$targetFile = "src-tauri/src/runtime/parakeet_text.rs"

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

    # Lire la prochaine tache depuis la liste
    $currentTask = Get-NextTask
    if ($null -eq $currentTask) {
        Write-Host "  TOUTES LES TACHES SONT COMPLETES. Fin de la boucle." -ForegroundColor Green
        break
    }
    Write-Host "  Tache: [$($currentTask.Id)] $($currentTask.Title)" -ForegroundColor Cyan

    # Determine fichier cible selon groupe de tache
    $targetFile = "src-tauri/src/runtime/parakeet_text.rs"
    if ($currentTask.Id -match "^H") { $targetFile = "src-tauri/src/actions/transcribe.rs" }

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
    $prompt = Build-Prompt $i $analysis $historyText $currentTask
    $promptFile = "$REPO\agent_prompt_temp.txt"
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($promptFile, $prompt, $utf8NoBom)

    # Snapshot avant
    Push-Location $REPO
    $filesBefore = (git diff --name-only 2>$null) | Where-Object { $_ -match "^src-tauri/" }
    Pop-Location

    Write-Host "  Fichier cible: $targetFile" -ForegroundColor Gray

    # Creer .aiderignore temporaire pour empecher l'auto-ajout des gros fichiers
    $aiderIgnore = "$REPO\.aiderignore"
    # Ignore tout sauf le fichier cible
    if ($targetFile -match "transcribe") {
        $ignoreContent = "src-tauri/src/runtime/parakeet_quality.rs`nsrc-tauri/src/runtime/chunking.rs`nsrc-tauri/src/runtime/parakeet_text.rs"
    } else {
        # default: parakeet_text.rs
        $ignoreContent = "src-tauri/src/actions/transcribe.rs`nsrc-tauri/src/runtime/parakeet_quality.rs`nsrc-tauri/src/runtime/chunking.rs"
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
        $msg = "Iter ${i} [$($currentTask.Id)]: Aucune modification (NO_CHANGE). Tache marquee SKIPPED."
        Write-Host "  $msg" -ForegroundColor Yellow
        $history.Add($msg)
        # Marquer comme SKIPPED pour passer a la suivante (pas bloque sur la meme tache)
        if ($currentTask) { Set-TaskStatus $currentTask.Id "SKIPPED" }
        continue
    }

    Write-Host "  Fichiers modifies: $($changedFiles -join ', ')" -ForegroundColor Cyan

    # Cargo check
    $compileOk = Run-CargoCheck
    if (-not $compileOk) {
        $msg = "Iter ${i} [$($currentTask.Id)]: REJETE - ne compile pas. Fichiers: $($changedFiles -join ', ')"
        Write-Host "  $msg" -ForegroundColor Red
        $history.Add($msg)
        if ($currentTask) { Set-TaskStatus $currentTask.Id "REJECTED" }
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

        # Marquer la tache comme DONE dans la liste
        if ($currentTask) { Set-TaskStatus $currentTask.Id "DONE" }

        Push-Location $REPO
        $taskLabel = if ($currentTask) { "[$($currentTask.Id)] $($currentTask.Title)" } else { "unknown" }
        $commitMsg = "agent $($currentTask.Id): local=$newLocalWer% fleurs=$newFleursWer% | $taskLabel"
        foreach ($cf in $changedFiles) { git add $cf 2>&1 | Out-Null }
        git add "src-tauri/evals/parakeet/ROBOT_TASK_LIST.md" 2>&1 | Out-Null
        git commit -m $commitMsg 2>&1 | Out-Null
        Pop-Location

        $msg = "Iter ${i} [$($currentTask.Id)]: ACCEPTE - local $currentLocalWer%->$newLocalWer% FLEURS $currentFleursWer%->$newFleursWer%"
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

        # Marquer la tache comme REJECTED dans la liste
        if ($currentTask) { Set-TaskStatus $currentTask.Id "REJECTED" }

        $msg = "Iter ${i} [$($currentTask.Id)]: REJETE - $reason"
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
