@echo off
chcp 65001 >nul
setlocal
title Vocalype Brain â€” Mode OpÃ©rationnel
set "REPO=C:\developer\sas\vocalype"
cd /d "%REPO%"

echo ============================================================
echo   VOCALYPE BRAIN â€” MODE OPÃ‰RATIONNEL
echo   measure â†’ decide â†’ mission â†’ execute â†’ review â†’ learn
echo ============================================================
echo.

echo [1/3] GÃ©nÃ©ration du rapport unifiÃ© hebdomadaire...
python internal/brain\scripts\generate_unified_report.py
if errorlevel 1 (
    echo.
    echo   ERREUR : generate_unified_report.py a Ã©chouÃ©.
    echo   VÃ©rifie que Python est installÃ© et que tu es dans le bon dossier.
    echo.
    pause
    exit /b 1
)
echo   OK â€” outputs\unified_weekly_report.md mis Ã  jour.
echo.

echo [2/3] GÃ©nÃ©ration du package mission V11...
python internal/brain\scripts\generate_v11_mission_package.py
if errorlevel 1 (
    echo.
    echo   ERREUR : generate_v11_mission_package.py a Ã©chouÃ©.
    echo   Le rapport unifiÃ© est quand mÃªme disponible.
    echo.
)
echo   OK â€” outputs\v11_mission_package.md prÃªt.
echo.

echo [3/3] Ouverture des fichiers clÃ©s...
if exist "internal/brain\outputs\weekly_action.md" (
    start "" "internal/brain\outputs\weekly_action.md"
) else (
    echo   AVERTISSEMENT : weekly_action.md introuvable.
)
if exist "internal/brain\outputs\v11_mission_package.md" (
    start "" "internal/brain\outputs\v11_mission_package.md"
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

