@echo off
chcp 65001 >nul
setlocal
title Vocalype Brain â€” Voir Rapports
set "REPO=C:\developer\sas\vocalype"
cd /d "%REPO%"

echo ============================================================
echo   VOCALYPE BRAIN â€” VOIR TOUS LES RAPPORTS
echo ============================================================
echo.

set "OPENED=0"

if exist "internal/brain\outputs\unified_weekly_report.md" (
    start "" "internal/brain\outputs\unified_weekly_report.md"
    echo   unified_weekly_report.md ouvert.
    set "OPENED=1"
) else ( echo   unified_weekly_report.md : absent )

if exist "internal/brain\outputs\weekly_action.md" (
    start "" "internal/brain\outputs\weekly_action.md"
    echo   weekly_action.md ouvert.
    set "OPENED=1"
) else ( echo   weekly_action.md : absent )

if exist "internal/brain\outputs\v11_mission_package.md" (
    start "" "internal/brain\outputs\v11_mission_package.md"
    echo   v11_mission_package.md ouvert.
    set "OPENED=1"
) else ( echo   v11_mission_package.md : absent )

if exist "internal/brain\outputs\results_report.md" (
    start "" "internal/brain\outputs\results_report.md"
    echo   results_report.md ouvert.
    set "OPENED=1"
) else ( echo   results_report.md : absent )

if exist "internal/brain\outputs\benchmark_report.md" (
    start "" "internal/brain\outputs\benchmark_report.md"
    echo   benchmark_report.md ouvert.
    set "OPENED=1"
) else ( echo   benchmark_report.md : absent )

if exist "internal/brain\outputs\business_report.md" (
    start "" "internal/brain\outputs\business_report.md"
    echo   business_report.md ouvert.
    set "OPENED=1"
) else ( echo   business_report.md : absent )

if exist "internal/brain\outputs\content_report.md" (
    start "" "internal/brain\outputs\content_report.md"
    echo   content_report.md ouvert.
    set "OPENED=1"
) else ( echo   content_report.md : absent )

echo.
if "%OPENED%"=="0" (
    echo   Aucun rapport trouvÃ©.
    echo   Lance "Lancer Vocalype Brain.bat" pour les gÃ©nÃ©rer.
) else (
    echo   Les rapports disponibles ont Ã©tÃ© ouverts dans ton Ã©diteur.
)

echo.
pause

