@echo off
chcp 65001 >nul
setlocal
title Vocalype Brain â€” GÃ©nÃ©rer Mission Claude
set "REPO=C:\developer\sas\vocalype"
cd /d "%REPO%"

echo ============================================================
echo   VOCALYPE BRAIN â€” GÃ‰NÃ‰RER MISSION CLAUDE / CODEX
echo ============================================================
echo.
echo Ce script gÃ©nÃ¨re un package mission prÃªt Ã  coller dans Claude.
echo Le package contient : contexte, fichiers autorisÃ©s, questions,
echo format de rÃ©ponse attendu, et rÃ¨gles de sÃ©curitÃ©.
echo.

echo [1/2] GÃ©nÃ©ration du package mission V11...
python internal/brain\scripts\generate_v11_mission_package.py
if errorlevel 1 (
    echo.
    echo   ERREUR : generate_v11_mission_package.py a Ã©chouÃ©.
    echo   Assure-toi qu'un rapport unifiÃ© existe dÃ©jÃ .
    echo   Lance "Lancer Vocalype Brain.bat" en premier si besoin.
    echo.
    pause
    exit /b 1
)
echo   OK.
echo.

echo [2/2] Ouverture du package mission...
if exist "internal/brain\outputs\v11_mission_package.md" (
    start "" "internal/brain\outputs\v11_mission_package.md"
    echo   v11_mission_package.md ouvert.
    echo.
    echo   PROCHAINE Ã‰TAPE :
    echo   Copie le contenu de ce fichier et colle-le dans Claude,
    echo   Codex, ou Aider pour exÃ©cuter la mission.
) else (
    echo   AVERTISSEMENT : v11_mission_package.md introuvable aprÃ¨s gÃ©nÃ©ration.
)

echo.
if exist "internal/brain\outputs\v11_mission_package_report.md" (
    start "" "internal/brain\outputs\v11_mission_package_report.md"
    echo   Rapport de sÃ©curitÃ© des portes ouvert Ã©galement.
)

echo.
pause

