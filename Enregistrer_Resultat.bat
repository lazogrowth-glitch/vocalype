@echo off
chcp 65001 >nul
setlocal
title Vocalype Brain — Enregistrer Résultat
set "REPO=C:\developer\sas\vocalype"
cd /d "%REPO%"

echo ============================================================
echo   VOCALYPE BRAIN — ENREGISTRER ET VOIR RÉSULTATS
echo ============================================================
echo.
echo Ce script relance tous les scripts de review disponibles
echo et ouvre les rapports générés.
echo.

set "ANY_ERROR=0"

echo [1/4] Résultats produit...
if exist "vocalype-brain\scripts\review_results.py" (
    python vocalype-brain\scripts\review_results.py
    if errorlevel 1 ( echo   AVERTISSEMENT : review_results.py a retourné une erreur. && set "ANY_ERROR=1" )
) else (
    echo   review_results.py introuvable — ignoré.
)
echo.

echo [2/4] Benchmarks produit...
if exist "vocalype-brain\scripts\review_benchmarks.py" (
    python vocalype-brain\scripts\review_benchmarks.py
    if errorlevel 1 ( echo   AVERTISSEMENT : review_benchmarks.py a retourné une erreur. && set "ANY_ERROR=1" )
) else (
    echo   review_benchmarks.py introuvable — ignoré.
)
echo.

echo [3/4] Métriques business...
if exist "vocalype-brain\scripts\review_business_metrics.py" (
    python vocalype-brain\scripts\review_business_metrics.py
    if errorlevel 1 ( echo   AVERTISSEMENT : review_business_metrics.py a retourné une erreur. && set "ANY_ERROR=1" )
) else (
    echo   review_business_metrics.py introuvable — ignoré.
)
echo.

echo [4/4] Performance contenu...
if exist "vocalype-brain\scripts\review_content_performance.py" (
    python vocalype-brain\scripts\review_content_performance.py
    if errorlevel 1 ( echo   AVERTISSEMENT : review_content_performance.py a retourné une erreur. && set "ANY_ERROR=1" )
) else (
    echo   review_content_performance.py introuvable — ignoré.
)
echo.

echo ============================================================
echo   Ouverture des rapports disponibles...
echo ============================================================
echo.

if exist "vocalype-brain\outputs\results_report.md" (
    start "" "vocalype-brain\outputs\results_report.md"
    echo   results_report.md ouvert.
)
if exist "vocalype-brain\outputs\benchmark_report.md" (
    start "" "vocalype-brain\outputs\benchmark_report.md"
    echo   benchmark_report.md ouvert.
)
if exist "vocalype-brain\outputs\business_report.md" (
    start "" "vocalype-brain\outputs\business_report.md"
    echo   business_report.md ouvert.
)
if exist "vocalype-brain\outputs\content_report.md" (
    start "" "vocalype-brain\outputs\content_report.md"
    echo   content_report.md ouvert.
)

echo.
if "%ANY_ERROR%"=="1" (
    echo   Certains scripts ont retourné des erreurs — voir ci-dessus.
) else (
    echo   Tous les scripts ont réussi.
)
echo.
pause
