@echo off
chcp 65001 >nul
setlocal
title Vocalype Brain â€” Enregistrer RÃ©sultat
set "REPO=C:\developer\sas\vocalype"
cd /d "%REPO%"

echo ============================================================
echo   VOCALYPE BRAIN â€” ENREGISTRER ET VOIR RÃ‰SULTATS
echo ============================================================
echo.
echo Ce script relance tous les scripts de review disponibles
echo et ouvre les rapports gÃ©nÃ©rÃ©s.
echo.

set "ANY_ERROR=0"

echo [1/4] RÃ©sultats produit...
if exist "internal/brain\scripts\review_results.py" (
    python internal/brain\scripts\review_results.py
    if errorlevel 1 ( echo   AVERTISSEMENT : review_results.py a retournÃ© une erreur. && set "ANY_ERROR=1" )
) else (
    echo   review_results.py introuvable â€” ignorÃ©.
)
echo.

echo [2/4] Benchmarks produit...
if exist "internal/brain\scripts\review_benchmarks.py" (
    python internal/brain\scripts\review_benchmarks.py
    if errorlevel 1 ( echo   AVERTISSEMENT : review_benchmarks.py a retournÃ© une erreur. && set "ANY_ERROR=1" )
) else (
    echo   review_benchmarks.py introuvable â€” ignorÃ©.
)
echo.

echo [3/4] MÃ©triques business...
if exist "internal/brain\scripts\review_business_metrics.py" (
    python internal/brain\scripts\review_business_metrics.py
    if errorlevel 1 ( echo   AVERTISSEMENT : review_business_metrics.py a retournÃ© une erreur. && set "ANY_ERROR=1" )
) else (
    echo   review_business_metrics.py introuvable â€” ignorÃ©.
)
echo.

echo [4/4] Performance contenu...
if exist "internal/brain\scripts\review_content_performance.py" (
    python internal/brain\scripts\review_content_performance.py
    if errorlevel 1 ( echo   AVERTISSEMENT : review_content_performance.py a retournÃ© une erreur. && set "ANY_ERROR=1" )
) else (
    echo   review_content_performance.py introuvable â€” ignorÃ©.
)
echo.

echo ============================================================
echo   Ouverture des rapports disponibles...
echo ============================================================
echo.

if exist "internal/brain\outputs\results_report.md" (
    start "" "internal/brain\outputs\results_report.md"
    echo   results_report.md ouvert.
)
if exist "internal/brain\outputs\benchmark_report.md" (
    start "" "internal/brain\outputs\benchmark_report.md"
    echo   benchmark_report.md ouvert.
)
if exist "internal/brain\outputs\business_report.md" (
    start "" "internal/brain\outputs\business_report.md"
    echo   business_report.md ouvert.
)
if exist "internal/brain\outputs\content_report.md" (
    start "" "internal/brain\outputs\content_report.md"
    echo   content_report.md ouvert.
)

echo.
if "%ANY_ERROR%"=="1" (
    echo   Certains scripts ont retournÃ© des erreurs â€” voir ci-dessus.
) else (
    echo   Tous les scripts ont rÃ©ussi.
)
echo.
pause

