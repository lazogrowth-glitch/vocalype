@echo off
chcp 65001 >nul
setlocal
title Vocalype Brain â€” Action de la semaine
set "REPO=C:\developer\sas\vocalype"
cd /d "%REPO%"

echo ============================================================
echo   VOCALYPE BRAIN â€” ACTION DE LA SEMAINE
echo ============================================================
echo.

if exist "internal/brain\outputs\weekly_action.md" (
    echo Ouverture de weekly_action.md...
    start "" "internal/brain\outputs\weekly_action.md"
    echo.
    echo Le fichier s'ouvre dans ton Ã©diteur par dÃ©faut.
    echo C'est l'action prioritaire choisie par le Brain cette semaine.
) else (
    echo   FICHIER INTROUVABLE : weekly_action.md
    echo.
    echo   Lance d'abord "Lancer Vocalype Brain.bat" pour gÃ©nÃ©rer
    echo   le rapport unifiÃ© et l'action de la semaine.
    echo.
    echo   Commande manuelle :
    echo     python internal/brain\scripts\generate_unified_report.py
)

echo.
pause

