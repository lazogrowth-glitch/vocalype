@echo off
chcp 65001 >nul
setlocal
title Vocalype Brain — Voir Rapports
set "REPO=C:\developer\sas\vocalype"
cd /d "%REPO%"

echo ============================================================
echo   VOCALYPE BRAIN — VOIR TOUS LES RAPPORTS
echo ============================================================
echo.

set "OPENED=0"

if exist "vocalype-brain\outputs\unified_weekly_report.md" (
    start "" "vocalype-brain\outputs\unified_weekly_report.md"
    echo   unified_weekly_report.md ouvert.
    set "OPENED=1"
) else ( echo   unified_weekly_report.md : absent )

if exist "vocalype-brain\outputs\weekly_action.md" (
    start "" "vocalype-brain\outputs\weekly_action.md"
    echo   weekly_action.md ouvert.
    set "OPENED=1"
) else ( echo   weekly_action.md : absent )

if exist "vocalype-brain\outputs\v11_mission_package.md" (
    start "" "vocalype-brain\outputs\v11_mission_package.md"
    echo   v11_mission_package.md ouvert.
    set "OPENED=1"
) else ( echo   v11_mission_package.md : absent )

if exist "vocalype-brain\outputs\results_report.md" (
    start "" "vocalype-brain\outputs\results_report.md"
    echo   results_report.md ouvert.
    set "OPENED=1"
) else ( echo   results_report.md : absent )

if exist "vocalype-brain\outputs\benchmark_report.md" (
    start "" "vocalype-brain\outputs\benchmark_report.md"
    echo   benchmark_report.md ouvert.
    set "OPENED=1"
) else ( echo   benchmark_report.md : absent )

if exist "vocalype-brain\outputs\business_report.md" (
    start "" "vocalype-brain\outputs\business_report.md"
    echo   business_report.md ouvert.
    set "OPENED=1"
) else ( echo   business_report.md : absent )

if exist "vocalype-brain\outputs\content_report.md" (
    start "" "vocalype-brain\outputs\content_report.md"
    echo   content_report.md ouvert.
    set "OPENED=1"
) else ( echo   content_report.md : absent )

echo.
if "%OPENED%"=="0" (
    echo   Aucun rapport trouvé.
    echo   Lance "Lancer Vocalype Brain.bat" pour les générer.
) else (
    echo   Les rapports disponibles ont été ouverts dans ton éditeur.
)

echo.
pause
