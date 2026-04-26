@echo off
chcp 65001 >nul
setlocal
title Vocalype Brain — Contexte DeepSeek / Claude
set "REPO=C:\developer\sas\vocalype"
cd /d "%REPO%"

echo ============================================================
echo   VOCALYPE BRAIN — CRÉER CONTEXTE POUR MODÈLE EXTERNE
echo   (DeepSeek Flash ou Claude manuel)
echo ============================================================
echo.
echo Ce script prépare un fichier de contexte sûr à envoyer à
echo un modèle externe pour du raisonnement long-contexte.
echo.
echo AUCUN fichier n'est envoyé automatiquement.
echo Tu dois copier/coller context_pack.md manuellement.
echo.

echo [1/4] Vérification de la configuration DeepSeek...
python vocalype-brain\scripts\check_deepseek_setup.py
echo.

echo [2/4] Construction du pack de contexte...
python vocalype-brain\scripts\build_context_pack.py
if errorlevel 1 (
    echo.
    echo   ERREUR : build_context_pack.py a échoué.
    pause
    exit /b 1
)
echo.

echo [3/4] Recommandation de routage pour raisonnement long...
python vocalype-brain\scripts\model_route_decision.py --task-type long_reasoning
echo.

echo [4/4] Ouverture des fichiers...
if exist "vocalype-brain\outputs\context_pack.md" (
    start "" "vocalype-brain\outputs\context_pack.md"
    echo   context_pack.md ouvert.
) else (
    echo   AVERTISSEMENT : context_pack.md introuvable.
)
if exist "vocalype-brain\outputs\model_route_decision.md" (
    start "" "vocalype-brain\outputs\model_route_decision.md"
    echo   model_route_decision.md ouvert.
)

echo.
echo ============================================================
echo   PROCHAINE ÉTAPE :
echo   1. Lis context_pack.md pour confirmer son contenu
echo   2. Copie-le dans ta session DeepSeek ou Claude
echo   3. Ne jamais envoyer src-tauri/, src/, backend/ ou .env
echo ============================================================
echo.
pause
