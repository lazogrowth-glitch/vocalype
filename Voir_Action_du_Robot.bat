@echo off
chcp 65001 >nul
setlocal
title Vocalype Brain — Action de la semaine
set "REPO=C:\developer\sas\vocalype"
cd /d "%REPO%"

echo ============================================================
echo   VOCALYPE BRAIN — ACTION DE LA SEMAINE
echo ============================================================
echo.

if exist "vocalype-brain\outputs\weekly_action.md" (
    echo Ouverture de weekly_action.md...
    start "" "vocalype-brain\outputs\weekly_action.md"
    echo.
    echo Le fichier s'ouvre dans ton éditeur par défaut.
    echo C'est l'action prioritaire choisie par le Brain cette semaine.
) else (
    echo   FICHIER INTROUVABLE : weekly_action.md
    echo.
    echo   Lance d'abord "Lancer Vocalype Brain.bat" pour générer
    echo   le rapport unifié et l'action de la semaine.
    echo.
    echo   Commande manuelle :
    echo     python vocalype-brain\scripts\generate_unified_report.py
)

echo.
pause
