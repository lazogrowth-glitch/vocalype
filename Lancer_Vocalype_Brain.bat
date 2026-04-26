@echo off
chcp 65001 >nul
setlocal
title Vocalype Brain — Mode Opérationnel
set "REPO=C:\developer\sas\vocalype"
cd /d "%REPO%"

echo ============================================================
echo   VOCALYPE BRAIN — MODE OPÉRATIONNEL
echo   measure → decide → mission → execute → review → learn
echo ============================================================
echo.

echo [1/3] Génération du rapport unifié hebdomadaire...
python vocalype-brain\scripts\generate_unified_report.py
if errorlevel 1 (
    echo.
    echo   ERREUR : generate_unified_report.py a échoué.
    echo   Vérifie que Python est installé et que tu es dans le bon dossier.
    echo.
    pause
    exit /b 1
)
echo   OK — outputs\unified_weekly_report.md mis à jour.
echo.

echo [2/3] Génération du package mission V11...
python vocalype-brain\scripts\generate_v11_mission_package.py
if errorlevel 1 (
    echo.
    echo   ERREUR : generate_v11_mission_package.py a échoué.
    echo   Le rapport unifié est quand même disponible.
    echo.
)
echo   OK — outputs\v11_mission_package.md prêt.
echo.

echo [3/3] Ouverture des fichiers clés...
if exist "vocalype-brain\outputs\weekly_action.md" (
    start "" "vocalype-brain\outputs\weekly_action.md"
) else (
    echo   AVERTISSEMENT : weekly_action.md introuvable.
)
if exist "vocalype-brain\outputs\v11_mission_package.md" (
    start "" "vocalype-brain\outputs\v11_mission_package.md"
) else (
    echo   AVERTISSEMENT : v11_mission_package.md introuvable.
)

echo.
echo ============================================================
echo   FAIT. Lis weekly_action.md pour l'action de la semaine.
echo   Copie le contenu de v11_mission_package.md dans Claude.
echo ============================================================
echo.
pause
