@echo off
chcp 65001 >nul
setlocal
title Vocalype Brain — Générer Mission Claude
set "REPO=C:\developer\sas\vocalype"
cd /d "%REPO%"

echo ============================================================
echo   VOCALYPE BRAIN — GÉNÉRER MISSION CLAUDE / CODEX
echo ============================================================
echo.
echo Ce script génère un package mission prêt à coller dans Claude.
echo Le package contient : contexte, fichiers autorisés, questions,
echo format de réponse attendu, et règles de sécurité.
echo.

echo [1/2] Génération du package mission V11...
python vocalype-brain\scripts\generate_v11_mission_package.py
if errorlevel 1 (
    echo.
    echo   ERREUR : generate_v11_mission_package.py a échoué.
    echo   Assure-toi qu'un rapport unifié existe déjà.
    echo   Lance "Lancer Vocalype Brain.bat" en premier si besoin.
    echo.
    pause
    exit /b 1
)
echo   OK.
echo.

echo [2/2] Ouverture du package mission...
if exist "vocalype-brain\outputs\v11_mission_package.md" (
    start "" "vocalype-brain\outputs\v11_mission_package.md"
    echo   v11_mission_package.md ouvert.
    echo.
    echo   PROCHAINE ÉTAPE :
    echo   Copie le contenu de ce fichier et colle-le dans Claude,
    echo   Codex, ou Aider pour exécuter la mission.
) else (
    echo   AVERTISSEMENT : v11_mission_package.md introuvable après génération.
)

echo.
if exist "vocalype-brain\outputs\v11_mission_package_report.md" (
    start "" "vocalype-brain\outputs\v11_mission_package_report.md"
    echo   Rapport de sécurité des portes ouvert également.
)

echo.
pause
