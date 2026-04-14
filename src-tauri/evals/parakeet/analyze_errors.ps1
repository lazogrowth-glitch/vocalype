$report = Get-Content 'C:\developer\sas\vocalype\src-tauri\evals\parakeet\external-fleurs-supported-400-no-hi-fr-punct.json' | ConvertFrom-Json
$bad = $report.samples | Where-Object { $_.wer -gt 0.2 } | Sort-Object wer -Descending | Select-Object -First 60
foreach ($s in $bad) {
    Write-Output "=== $($s.id) [$($s.language)] WER=$($s.wer) OMIT=$($s.omit_rate) HALL=$($s.hall_rate) END=$($s.end_score)"
    Write-Output "  HYP: $($s.hypothesis)"
    Write-Output "  REF: $($s.reference)"
    $omitList = ($s.omitted_words | Select-Object -First 20) -join ', '
    $hallList = ($s.hallucinated_words | Select-Object -First 20) -join ', '
    Write-Output "  OMIT: $omitList"
    Write-Output "  HALL: $hallList"
    Write-Output ""
}

Write-Output "--- Global omit freq ---"
$allOmit = $report.samples | ForEach-Object { $_.omitted_words } | Group-Object | Sort-Object Count -Descending | Select-Object -First 40
foreach ($g in $allOmit) { Write-Output "$($g.Count) $($g.Name)" }

Write-Output ""
Write-Output "--- Global hall freq ---"
$allHall = $report.samples | ForEach-Object { $_.hallucinated_words } | Group-Object | Sort-Object Count -Descending | Select-Object -First 40
foreach ($g in $allHall) { Write-Output "$($g.Count) $($g.Name)" }

Write-Output ""
Write-Output "--- By language WER > 0.15 ---"
foreach ($lang in @('en','es','fr','pt')) {
    $langSamples = $report.samples | Where-Object { $_.language -eq "fleurs_$lang" -and $_.wer -gt 0.15 } | Sort-Object wer -Descending
    Write-Output "=== $lang high-WER count: $($langSamples.Count) ==="
    foreach ($s in $langSamples | Select-Object -First 15) {
        Write-Output "  $($s.id) WER=$([math]::Round($s.wer,3)) | HYP: $($s.hypothesis.Substring(0,[math]::Min(120,$s.hypothesis.Length)))"
        Write-Output "  REF: $($s.reference.Substring(0,[math]::Min(120,$s.reference.Length)))"
    }
}
