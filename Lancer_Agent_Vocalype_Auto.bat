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
    echo   [OUVERT] agent_recommendation.md
) else (
    echo   [MANQUANT] agent_recommendation.md introuvable.
)

if exist "C:\developer\sas\vocalype\vocalype-brain\outputs\agent_run_report.md" (
    start "" "C:\developer\sas\vocalype\vocalype-brain\outputs\agent_run_report.md"
    echo   [OUVERT] agent_run_report.md
) else (
    echo   [MANQUANT] agent_run_report.md introuvable.
)

if exist "C:\developer\sas\vocalype\vocalype-brain\outputs\fresh_investigation_mission.md" (
    start "" "C:\developer\sas\vocalype\vocalype-brain\outputs\fresh_investigation_mission.md"
    echo   [OUVERT] fresh_investigation_mission.md -- copie-colle dans Claude/Codex
) else (
    echo   [--] fresh_investigation_mission.md : pas cree -- aucune mission fraiche ce cycle
)

if exist "C:\developer\sas\vocalype\vocalype-brain\outputs\next_product_bottleneck.md" (
    start "" "C:\developer\sas\vocalype\vocalype-brain\outputs\next_product_bottleneck.md"
    echo   [OUVERT] next_product_bottleneck.md
) else (
    echo   [--] next_product_bottleneck.md : pas cree ce cycle
)

if exist "C:\developer\sas\vocalype\vocalype-brain\outputs\deepseek_response.md" (
    start "" "C:\developer\sas\vocalype\vocalype-brain\outputs\deepseek_response.md"
    echo   [OUVERT] deepseek_response.md
)

echo.
echo ============================================================
echo   FAIT.
echo.
echo   Si fresh_investigation_mission.md s'est ouvert :
echo     copie-colle ce fichier dans Claude/Codex.
echo.
echo   Si aucune mission fraiche ne s'est ouverte :
echo     lis agent_recommendation.md pour la prochaine action.
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