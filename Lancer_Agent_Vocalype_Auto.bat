@echo off
chcp 65001 >nul
setlocal
title Vocalype Brain - Agent Auto
set "REPO=C:\developer\sas\vocalype"
cd /d "C:\developer\sas\vocalype"

echo ============================================================
echo   VOCALYPE BRAIN - AGENT AUTO
echo   Classifie l'action, route vers le bon outil
echo ============================================================
echo.
echo   Ce script :
echo     1. Lance le cycle operationnel (rapport + mission)
echo     2. Classifie automatiquement l'action de la semaine
echo     3. Route vers Ollama local, DeepSeek, ou mission Claude
echo.
echo   Mode externe actuel :
if defined VOCALYPE_BRAIN_EXTERNAL_MODE (
    echo     VOCALYPE_BRAIN_EXTERNAL_MODE=%VOCALYPE_BRAIN_EXTERNAL_MODE%
) else (
    echo     VOCALYPE_BRAIN_EXTERNAL_MODE=confirm (defaut -- DeepSeek NON appele)
)
echo.

echo [Agent] Lancement du routeur operationnel...
python "C:\developer\sas\vocalype\vocalype-brain\scripts\run_operating_agent.py"
if errorlevel 1 (
    echo.
    echo   ERREUR : run_operating_agent.py a echoue.
    echo   Verifie que Python est installe et que tu es dans le bon dossier.
    echo.
    pause
    exit /b 1
)

echo.
echo [Ouverture] Lecture des resultats...

if exist "C:\developer\sas\vocalype\vocalype-brain\outputs\agent_recommendation.md" (
    start "" "C:\developer\sas\vocalype\vocalype-brain\outputs\agent_recommendation.md"
    echo   agent_recommendation.md ouvert.
) else (
    echo   AVERTISSEMENT : agent_recommendation.md introuvable.
)

if exist "C:\developer\sas\vocalype\vocalype-brain\outputs\agent_run_report.md" (
    start "" "C:\developer\sas\vocalype\vocalype-brain\outputs\agent_run_report.md"
    echo   agent_run_report.md ouvert.
)

if exist "C:\developer\sas\vocalype\vocalype-brain\outputs\deepseek_response.md" (
    start "" "C:\developer\sas\vocalype\vocalype-brain\outputs\deepseek_response.md"
    echo   deepseek_response.md ouvert.
)

echo.
echo ============================================================
echo   FAIT. Lis agent_recommendation.md pour la prochaine etape.
echo.
echo   Si agent_recommendation.md demande une mission Claude/Codex,
echo   ouvre manuellement :
echo     vocalype-brain\outputs\v11_mission_package.md
echo.
echo   Modes externes disponibles :
echo     off     = jamais appeler DeepSeek, preparer context_pack seulement
echo     confirm = (DEFAUT) preparer context_pack + instructions fondateur
echo     auto    = appeler DeepSeek si DEEPSEEK_API_KEY configure
echo.
echo   Pour activer auto (PowerShell) :
    echo     $env:VOCALYPE_BRAIN_EXTERNAL_MODE = "auto"
echo   Pour activer auto (CMD) :
    echo     set VOCALYPE_BRAIN_EXTERNAL_MODE=auto
echo ============================================================
echo.
pause