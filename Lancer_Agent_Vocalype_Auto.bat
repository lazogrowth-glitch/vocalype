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
echo     3. Respecte le contrat de route -- ouvre seulement les bons fichiers
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

REM --- Read the final route from agent_route.txt (written by the agent) ---
set "ROUTE=unknown"
if exist "C:\developer\sas\vocalype\vocalype-brain\outputs\agent_route.txt" (
    set /p ROUTE=<"C:\developer\sas\vocalype\vocalype-brain\outputs\agent_route.txt"
)
echo.
echo [Route] Route finale detectee : %ROUTE%
echo.

echo [Ouverture] Lecture des resultats...
echo.

REM --- Always open: recommendation + run report ---
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

REM --- fresh_investigation_mission.md: ONLY for sensitive_code / product_implementation ---
if "%ROUTE%"=="sensitive_code"         goto open_mission
if "%ROUTE%"=="product_implementation" goto open_mission
goto skip_mission

:open_mission
if exist "C:\developer\sas\vocalype\vocalype-brain\outputs\fresh_investigation_mission.md" (
    start "" "C:\developer\sas\vocalype\vocalype-brain\outputs\fresh_investigation_mission.md"
    echo   [OUVERT] fresh_investigation_mission.md -- copie-colle dans Claude/Codex
) else (
    echo   [--] fresh_investigation_mission.md : pas cree ce cycle
)
goto after_mission

:skip_mission
echo   [--] fresh_investigation_mission.md : NON ouverte (route=%ROUTE%)
echo        Route data_entry/hold/observation_wait : pas de mission Claude a envoyer.

:after_mission

REM --- next_product_bottleneck.md: always open if present ---
if exist "C:\developer\sas\vocalype\vocalype-brain\outputs\next_product_bottleneck.md" (
    start "" "C:\developer\sas\vocalype\vocalype-brain\outputs\next_product_bottleneck.md"
    echo   [OUVERT] next_product_bottleneck.md
) else (
    echo   [--] next_product_bottleneck.md : pas cree ce cycle
)

REM --- deepseek_response.md: only if exists (auto mode only) ---
if exist "C:\developer\sas\vocalype\vocalype-brain\outputs\deepseek_response.md" (
    start "" "C:\developer\sas\vocalype\vocalype-brain\outputs\deepseek_response.md"
    echo   [OUVERT] deepseek_response.md
)

echo.
echo ============================================================
echo   FAIT -- Route : %ROUTE%
echo.
echo   CONTRAT DE ROUTE :
echo.
if "%ROUTE%"=="data_entry" (
    echo   [data_entry]
    echo     Suis les etapes locales dans agent_recommendation.md.
    echo     N'envoie PAS de mission a Claude/Codex.
    echo     Utilise les scripts CLI pour enregistrer tes observations.
    goto footer_done
)
if "%ROUTE%"=="observation_wait" (
    echo   [observation_wait]
    echo     Un patch diagnostique est deja en production.
    echo     Attends que le probleme se reproduise et collecte les logs.
    echo     Lis agent_recommendation.md pour les patterns de logs a chercher.
    echo     N'envoie PAS de mission a Claude/Codex.
    goto footer_done
)
if "%ROUTE%"=="hold" (
    echo   [hold]
    echo     Aucune action ce cycle.
    echo     Lis agent_recommendation.md.
    goto footer_done
)
if "%ROUTE%"=="sensitive_code" (
    echo   [sensitive_code]
    echo     Mission d'investigation disponible dans fresh_investigation_mission.md.
    echo     Copie-colle ce fichier dans Claude/Codex manuellement.
    echo     Le fondateur examine le diff avant tout commit.
    goto footer_done
)
if "%ROUTE%"=="product_implementation" (
    echo   [product_implementation]
    echo     Mission d'implementation disponible dans v11_mission_package.md.
    echo     Copie-colle dans Claude/Codex manuellement.
    goto footer_done
)
if "%ROUTE%"=="long_reasoning" (
    echo   [long_reasoning]
    echo     Context pack pret dans context_pack.md.
    echo     Colle-le dans claude.ai ou active VOCALYPE_BRAIN_EXTERNAL_MODE=auto.
    goto footer_done
)
echo   Route inconnue ou completed_action_blocked.
echo   Lis agent_recommendation.md pour la prochaine etape.

:footer_done
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
