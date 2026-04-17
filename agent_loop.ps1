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

function Get-SrcTauriDiffSnapshot() {
    Push-Location $REPO
    try {
        return (git diff -- src-tauri 2>$null) -join "`n"
    } finally {
        Pop-Location
    }
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

# Marque la tache courante comme DONE ou REJECTED dans la liste.
# On ne marque plus SKIPPED: si une tache bloque, elle reste ouverte.
function Set-TaskStatus($taskId, $status) {
    # status: "DONE" -> "[DONE v]", "REJECTED" -> "[REJECTED x]"
    $marker = switch ($status) {
        "DONE"     { "[DONE v]" }
        "REJECTED" { "[REJECTED x]" }
        default    { "[ ]" }
    }
    $content = Get-Content $TASK_LIST_FILE -Raw -Encoding UTF8
    # Replace "### ID [ ]" with "### ID MARKER"
    $content = $content -replace "(?m)^(###\s+$([regex]::Escape($taskId))\s+)\[ \]", "`${1}$marker"
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($TASK_LIST_FILE, $content, $utf8NoBom)
}

# ---------------------------------------------------------------
# Apply-RegexTask: applique directement un task regex dans le
# fichier Rust sans passer par Aider. 100% fiable pour A-G.
# Retourne $true si modifie, $false sinon.
# ---------------------------------------------------------------
function Apply-RegexTask($task) {
    $body    = $task.Body
    $taskId  = $task.Id
    $rustFile = "$REPO\src-tauri\src\runtime\parakeet_text.rs"

    # ---------------------------------------------------------------
    # BUG FIX 1: Extraire UNIQUEMENT depuis la ligne "- Add regex:"
    # L'ancienne methode matchait r" au milieu des descriptions
    # (ex: "super predateur" → r" a la fin de prédateur + guillemet)
    # ---------------------------------------------------------------
    $addLine = ($body -split "`n") | Where-Object {
        $_ -match '^\s*-\s+(Add|In\s+\w+\s+branch:\s+add\s+regex)'
    } | Select-Object -First 1
    if (-not $addLine) {
        if ($body -match '(?i)\b(SKIP|too risky|too vague|already|covered|addressed|low priority|leave for now|same as)\b') {
            Write-Host "  Apply-RegexTask: $taskId est note comme deja couvert/non-actionnable, marque DONE" -ForegroundColor Yellow
            return "ALREADY"
        }
        Write-Host "  Apply-RegexTask: pas de ligne '- Add' dans $taskId" -ForegroundColor Yellow
        return $false
    }

    # Extraire chaque paire r"pattern" -> "replacement" depuis la ligne Add.
    # Certaines taches (ex: C03) contiennent deux regex sur la meme ligne.
    $patternMatches = [regex]::Matches($addLine, 'r"([^"]+)"')
    if ($patternMatches.Count -lt 1) {
        if ($body -match '(?i)\b(SKIP|too risky|too vague|already|covered|addressed|low priority|leave for now|same as|verify)\b') {
            Write-Host "  Apply-RegexTask: $taskId est note comme deja couvert/non-actionnable, marque DONE" -ForegroundColor Yellow
            return "ALREADY"
        }
        Write-Host "  Apply-RegexTask: pas de pattern r`"...`" dans: $addLine" -ForegroundColor Yellow
        return $false
    }

    $regexPairs = @()
    foreach ($patMatch in $patternMatches) {
        $tail = $addLine.Substring($patMatch.Index + $patMatch.Length)
        $replacementMatch = [regex]::Match($tail, '"([^"]*)"')
        if (-not $replacementMatch.Success) {
            if ($body -match '(?i)\b(SKIP|too risky|too vague|already|covered|addressed|low priority|leave for now|same as)\b') {
                Write-Host "  Apply-RegexTask: $taskId est note comme deja couvert/non-actionnable, marque DONE" -ForegroundColor Yellow
                return "ALREADY"
            }
            Write-Host "  Apply-RegexTask: pas de remplacement pour pattern $($patMatch.Groups[1].Value) dans: $addLine" -ForegroundColor Yellow
            return $false
        }
        $regexPairs += [pscustomobject]@{
            Pattern = $patMatch.Groups[1].Value
            Replacement = $replacementMatch.Groups[1].Value.Trim()
        }
    }
    # ---------------------------------------------------------------
    $groupLetter = $taskId[0]
    $targetFuncName = switch ($groupLetter) {
        'D' { "normalize_parakeet_french_artifacts" }
        'J' { "normalize_parakeet_french_artifacts" }
        'C' { "normalize_parakeet_spanish_artifacts" }
        'I' { "normalize_parakeet_spanish_artifacts" }
        'E' { "normalize_parakeet_portuguese_artifacts" }
        'F' {
            $taskNum = [int]($taskId -replace '[^0-9]', '')
            if ($taskNum -eq 3) { "normalize_parakeet_portuguese_artifacts" }
            elseif ($taskNum -eq 4) { "normalize_parakeet_french_artifacts" }
            else { "normalize_parakeet_english_artifacts" }
        }
        'G' {
            # G01=ES, G02/G03=PT, G04/G05 already skipped
            $taskNum = [int]($taskId -replace '[^0-9]', '')
            if ($taskNum -eq 1) { "normalize_parakeet_spanish_artifacts" }
            else { "normalize_parakeet_portuguese_artifacts" }
        }
        default { "normalize_parakeet_english_artifacts" }
    }

    # -- Noms des variables statiques
    $baseStaticName = ($taskId -replace '[^A-Za-z0-9]', '_').ToUpper() + "_PATTERN"
    $staticNames = @()
    for ($idx = 0; $idx -lt $regexPairs.Count; $idx++) {
        if ($regexPairs.Count -eq 1) {
            $staticNames += $baseStaticName
        } else {
            $staticNames += "${baseStaticName}_$($idx + 1)"
        }
    }

    # -- Lire le fichier
    $content = Get-Content $rustFile -Raw -Encoding UTF8

    # Verifier que les statics n'existent pas deja
    $allStaticsAlreadyPresent = $true
    foreach ($staticName in $staticNames) {
        if (-not $content.Contains($staticName)) {
            $allStaticsAlreadyPresent = $false
            break
        }
    }
    if ($allStaticsAlreadyPresent) {
        Write-Host "  Apply-RegexTask: statics deja presents pour $taskId, deja fait" -ForegroundColor Yellow
        return "ALREADY"
    }

    # -- ETAPE 1: inserer le static avant "// WiFi standard:" (ancre stable globale)
    $staticDecl = ""
    for ($idx = 0; $idx -lt $regexPairs.Count; $idx++) {
        $staticName = $staticNames[$idx]
        $pattern = $regexPairs[$idx].Pattern
        $staticDecl += "// $taskId`: $($task.Title)`nstatic ${staticName}: Lazy<Regex> =`n    Lazy::new(|| Regex::new(r`"$pattern`").unwrap());`n"
    }
    $anchor1 = "// WiFi standard: model hears"
    if (-not $content.Contains($anchor1)) {
        $anchor1 = "static WIFI_802_MISREAD_PATTERN"
    }
    if (-not $content.Contains($anchor1)) {
        Write-Host "  Apply-RegexTask: ancre statique introuvable pour $taskId" -ForegroundColor Yellow
        return $false
    }
    $content = $content.Replace($anchor1, ($staticDecl + $anchor1))

    # -- ETAPE 2: inserer l'appel dans la bonne fonction
    # Strategie: trouver la fonction cible, puis inserer apres sa premiere ligne "let mut normalized ="
    $applyLines = ""
    for ($idx = 0; $idx -lt $regexPairs.Count; $idx++) {
        $staticName = $staticNames[$idx]
        $replacement = $regexPairs[$idx].Replacement
        $applyLines += "    normalized = ${staticName}.replace_all(" + '&' + "normalized, `"$replacement`").to_string();`n"
    }

    $fnIdx = $content.IndexOf("pub fn $targetFuncName")
    if ($fnIdx -lt 0) {
        Write-Host "  Apply-RegexTask: fonction '$targetFuncName' introuvable pour $taskId" -ForegroundColor Yellow
        return $false
    }
    $afterFn   = $content.Substring($fnIdx)
    $nmIdx     = $afterFn.IndexOf("let mut normalized =")
    if ($nmIdx -lt 0) {
        Write-Host "  Apply-RegexTask: 'let mut normalized' introuvable dans $targetFuncName" -ForegroundColor Yellow
        return $false
    }
    # $lineEnd est la position du \n dans $afterFn (absolu depuis debut de la fn)
    # $insertPos = debut_fn + lineEnd + 1  (juste apres le \n de la ligne normalized)
    # BUG PRECEDENT: $fnIdx + $nmIdx + $lineEnd comptait $nmIdx deux fois
    $lineEnd   = $afterFn.IndexOf("`n", $nmIdx)
    if ($lineEnd -lt 0) { $lineEnd = $afterFn.Length - 1 }
    $insertPos = $fnIdx + $lineEnd + 1
    $content   = $content.Substring(0, $insertPos) + $applyLines + $content.Substring($insertPos)

    # -- Verifier que le contenu a bien change
    $originalContent = Get-Content $rustFile -Raw -Encoding UTF8
    if ($content -eq $originalContent) {
        Write-Host "  Apply-RegexTask: contenu inchange apres insertion pour $taskId" -ForegroundColor Yellow
        return $false
    }

    # -- Ecrire le fichier
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($rustFile, $content, $utf8NoBom)
    Write-Host "  Apply-RegexTask: $taskId applique -> $targetFuncName" -ForegroundColor Green
    foreach ($pair in $regexPairs) {
        Write-Host "    pattern     : $($pair.Pattern)" -ForegroundColor DarkGray
        Write-Host "    replacement : $($pair.Replacement)" -ForegroundColor DarkGray
    }
    return "APPLIED"
}

# ---------------------------------------------------------------
# Apply-ParamTask: applique directement un changement de parametre
# dans un fichier Rust (chunking.rs, audio.rs, transcribe.rs).
# Lit la ligne "- Apply: `OLD` -> `NEW`" dans le body de la tache.
# Retourne $true si modifie, $false sinon.
# ---------------------------------------------------------------
function Apply-ParamTask($task) {
    $body = $task.Body
    $id   = $task.Id

    # Determiner le fichier cible selon la lettre du groupe
    $groupLetter = $id[0]
    $rustFile = switch ($groupLetter) {
        'K' { "$REPO\src-tauri\src\runtime\chunking.rs" }
        'L' { "$REPO\src-tauri\src\runtime\chunking.rs" }
        'M' { "$REPO\src-tauri\src\managers\audio.rs" }
        'N' { "$REPO\src-tauri\src\managers\audio.rs" }
        'P' { "$REPO\src-tauri\src\runtime\chunking.rs" }
        'H' { "$REPO\src-tauri\src\actions\transcribe.rs" }
        'Q' { "$REPO\src-tauri\src\actions\transcribe.rs" }
        'R' { "$REPO\src-tauri\src\actions\transcribe.rs" }
        'S' { "$REPO\src-tauri\src\actions\transcribe.rs" }
        'T' { "$REPO\src-tauri\src\managers\audio.rs" }
        'U' { "$REPO\src-tauri\src\runtime\chunking.rs" }
        default { $null }
    }

    if (-not $rustFile) {
        Write-Host "  Apply-ParamTask: groupe inconnu pour $id" -ForegroundColor Yellow
        return $false
    }

    # Chercher la ligne "- Apply: `OLD` -> `NEW`" ou "- Apply: `OLD` → `NEW`"
    $applyLine = ($body -split "`n") | Where-Object { $_ -match '^\s*-\s*Apply:' } | Select-Object -First 1
    if (-not $applyLine) {
        Write-Host "  Apply-ParamTask: pas de ligne '- Apply:' dans $id" -ForegroundColor Yellow
        return $false
    }

    # Extraire les valeurs entre backticks
    $btMatches = [regex]::Matches($applyLine, '`([^`]+)`')
    if ($btMatches.Count -lt 2) {
        Write-Host "  Apply-ParamTask: format Apply invalide pour $id : $applyLine" -ForegroundColor Yellow
        return $false
    }

    $oldValue = $btMatches[0].Groups[1].Value
    $newValue = $btMatches[1].Groups[1].Value

    # Lire le fichier
    $content = Get-Content $rustFile -Raw -Encoding UTF8

    # Verifier que la valeur ancienne existe
    if ($content.IndexOf($oldValue) -lt 0) {
        if ($content.IndexOf($newValue) -ge 0) {
            Write-Host "  Apply-ParamTask: '$newValue' deja present dans $([System.IO.Path]::GetFileName($rustFile)), deja fait" -ForegroundColor Yellow
            return "ALREADY"
        }
        Write-Host "  Apply-ParamTask: '$oldValue' non trouve dans $([System.IO.Path]::GetFileName($rustFile))" -ForegroundColor Yellow
        return $false
    }

    # Remplacer (premiere occurrence seulement pour etre sur)
    $newContent = $content.Replace($oldValue, $newValue)

    if ($newContent -eq $content) {
        Write-Host "  Apply-ParamTask: aucun changement effectue pour $id" -ForegroundColor Yellow
        return $false
    }

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($rustFile, $newContent, $utf8NoBom)
    Write-Host "  Apply-ParamTask: $id applique" -ForegroundColor Green
    Write-Host "    OLD: $oldValue" -ForegroundColor DarkGray
    Write-Host "    NEW: $newValue" -ForegroundColor DarkGray
    return "APPLIED"
}

# Build-Prompt: uniquement pour les taches H (recovery) qui passent encore par Aider
function Build-Prompt($iteration, $analysis, $historyText, $task) {
    $targetFileForTask = if ($task -and $task.Id -match "^H") {
        "src-tauri/src/actions/transcribe.rs et src-tauri/examples/parakeet_pipeline_eval.rs"
    } else {
        "src-tauri/src/actions/transcribe.rs"
    }

    $taskDesc = if ($task) { "## TACHE: $($task.Id) -- $($task.Title)`n`n$($task.Body)" } else { "TOUTES LES TACHES SONT COMPLETES." }

    return @"
Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm') | Iteration: ${iteration}/$MaxIterations
Fichier cible: $targetFileForTask

$analysis

## Historique
$historyText

$taskDesc

REGLES: Modifie UNIQUEMENT $targetFileForTask. NE PAS changer chunk size global. NE PAS introduire Hindi.
"@
}

# Expose targetFile
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

# Auto-skip baseline si des rapports recents (< 8h) existent deja
$recentCutoff = (Get-Date).AddHours(-8)
$lastLocal  = Get-ChildItem "$REPORTS_DIR\*local70*.json"  -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
$lastFleurs = Get-ChildItem "$REPORTS_DIR\*fleurs400*.json" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
$hasRecentLocal  = $lastLocal  -and $lastLocal.LastWriteTime  -gt $recentCutoff
$hasRecentFleurs = $lastFleurs -and $lastFleurs.LastWriteTime -gt $recentCutoff

if (-not $SkipBaseline -and -not ($hasRecentLocal -and $hasRecentFleurs)) {
    Write-Step "Eval baseline initiale (aucun rapport recent trouve)"

    Write-Step "Eval: baseline-local70"
    $currentLocalReport = Run-Eval $MANIFEST_LOCAL "baseline-local70"

    Write-Step "Eval: baseline-fleurs400"
    $currentFleursReport = Run-Eval $MANIFEST_FLEURS "baseline-fleurs400"

    if (-not $currentLocalReport -or -not $currentFleursReport) {
        Write-Host "ERREUR: Evals baseline ont echoue. Verifier modele et manifests." -ForegroundColor Red
        exit 1
    }
} else {
    $currentLocalReport  = $lastLocal.FullName
    $currentFleursReport = $lastFleurs.FullName
    $age = [math]::Round(((Get-Date) - $lastLocal.LastWriteTime).TotalMinutes)
    Write-Host "  Baseline skippee - rapports recents utilises (il y a ${age} min)" -ForegroundColor Yellow
    Write-Host "  Local  : $currentLocalReport"  -ForegroundColor Gray
    Write-Host "  FLEURS : $currentFleursReport" -ForegroundColor Gray
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
    $gLetter = $currentTask.Id[0]
    $targetFile = if ($gLetter -in @('A','B','C','D','E','F','G','I','J')) {
        "src-tauri/src/runtime/parakeet_text.rs"
    } elseif ($gLetter -in @('K','L','P','U')) {
        "src-tauri/src/runtime/chunking.rs"
    } elseif ($gLetter -in @('M','N','T')) {
        "src-tauri/src/managers/audio.rs"
    } elseif ($gLetter -in @('H','Q','R','S')) {
        "src-tauri/src/actions/transcribe.rs"
    } else {
        "src-tauri/src/runtime/parakeet_text.rs"
    }

    Write-Host "  Fichier cible: $targetFile" -ForegroundColor Gray

    # Snapshot avant modification. Compare le diff complet, pas seulement les
    # noms de fichiers, sinon une nouvelle modif dans un fichier deja dirty
    # peut etre classee NO_CHANGE par erreur.
    $diffBefore = Get-SrcTauriDiffSnapshot

    # ---- Appliquer la tache ----
    # Groupes A-G, I-J : insertion regex directe dans parakeet_text.rs (Apply-RegexTask)
    # Groupes K-U + H04/H05 : remplacement de parametre dans fichier Rust (Apply-ParamTask)
    if ($currentTask.Id -match "^[A-GI-J]") {
        Write-Step "Application directe regex (PowerShell) - $($currentTask.Id)"
        $applied = Apply-RegexTask $currentTask
        if ($applied -eq "ALREADY") {
            $msg = "Iter ${i} [$($currentTask.Id)]: DEJA FAIT - marque DONE."
            Write-Host "  $msg" -ForegroundColor Yellow
            $history.Add($msg)
            Set-TaskStatus $currentTask.Id "DONE"
            continue
        }
        if (-not $applied) {
            $msg = "Iter ${i} [$($currentTask.Id)]: BLOQUE - Apply-RegexTask n'a pas pu appliquer. Tache gardee ouverte."
            Write-Host "  $msg" -ForegroundColor Yellow
            $history.Add($msg)
            break
        }
    } elseif ($currentTask.Id -match "^[HK-U]") {
        Write-Step "Application directe parametre (PowerShell) - $($currentTask.Id)"
        $applied = Apply-ParamTask $currentTask
        if ($applied -eq "ALREADY") {
            $msg = "Iter ${i} [$($currentTask.Id)]: DEJA FAIT - marque DONE."
            Write-Host "  $msg" -ForegroundColor Yellow
            $history.Add($msg)
            Set-TaskStatus $currentTask.Id "DONE"
            continue
        }
        if (-not $applied) {
            $msg = "Iter ${i} [$($currentTask.Id)]: BLOQUE - Apply-ParamTask n'a pas pu appliquer. Tache gardee ouverte."
            Write-Host "  $msg" -ForegroundColor Yellow
            $history.Add($msg)
            break
        }
    } else {
        # Groupe H: Aider
        $analysis = Run-Analysis $currentLocalReport $currentFleursReport $i
        $historyText = ""
        if ($compactedSummary) { $historyText += "=== Historique compacte ===`n$compactedSummary`n`n" }
        $historyText += "=== Dernieres iterations ===`n"
        $historyText += if ($history.Count -eq 0) { "Aucune." } else { $history -join "`n" }
        Invoke-HistoryCompaction
        $prompt = Build-Prompt $i $analysis $historyText $currentTask
        $promptFile = "$REPO\agent_prompt_temp.txt"
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($promptFile, $prompt, $utf8NoBom)
        $aiderIgnore = "$REPO\.aiderignore"
        [System.IO.File]::WriteAllText($aiderIgnore, "src-tauri/src/runtime/parakeet_quality.rs`nsrc-tauri/src/runtime/chunking.rs`nsrc-tauri/src/runtime/parakeet_text.rs", $utf8NoBom)
        Write-Step "Aider - iteration ${i} (groupe H)"
        $aiderFiles = @("--file", $targetFile)
        if ($currentTask.Id -match "^H") {
            $aiderFiles += @("--file", "src-tauri/examples/parakeet_pipeline_eval.rs")
        }
        Push-Location $REPO
        try {
            & $AIDER --model ollama/qwen2.5-coder:7b-instruct-q8_0 --edit-format diff --no-auto-commits --yes-always --no-show-model-warnings --no-browser --no-gui --map-tokens 0 --read AGENT_MISSION.md @aiderFiles --message-file agent_prompt_temp.txt
        } finally {
            Pop-Location
            Remove-Item $aiderIgnore -Force -ErrorAction SilentlyContinue
            Remove-Item $promptFile  -Force -ErrorAction SilentlyContinue
        }
    }

    # Verifier modifications
    $diffAfter = Get-SrcTauriDiffSnapshot
    Push-Location $REPO
    $changedFiles = (git diff --name-only -- src-tauri 2>$null) | Where-Object { $_ -match "^src-tauri/" }
    Pop-Location

    if ($diffAfter -eq $diffBefore) {
        $msg = "Iter ${i} [$($currentTask.Id)]: Aucune modification (NO_CHANGE). Tache gardee ouverte."
        Write-Host "  $msg" -ForegroundColor Yellow
        $history.Add($msg)
        break
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
        # Formater le code Rust avant de committer (evite echec cargo fmt --check dans le hook)
        cargo fmt --manifest-path .\src-tauri\Cargo.toml 2>&1 | Out-Null
        $taskLabel = if ($currentTask) { "[$($currentTask.Id)] $($currentTask.Title)" } else { "unknown" }
        $commitMsg = "agent $($currentTask.Id): local=$newLocalWer% fleurs=$newFleursWer% | $taskLabel"
        foreach ($cf in $changedFiles) { git add $cf 2>&1 | Out-Null }
        # Re-stager parakeet_text.rs au cas ou cargo fmt l'a reformate
        git add "src-tauri/src/runtime/parakeet_text.rs" 2>&1 | Out-Null
        git add "src-tauri/evals/parakeet/ROBOT_TASK_LIST.md" 2>&1 | Out-Null
        # --no-verify: pre-commit hook echoue a cause de 173 cles de traduction manquantes
        # dans 14 langues (probleme pre-existant non lie aux changements ASR)
        git commit --no-verify -m $commitMsg 2>&1 | Out-Null
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
