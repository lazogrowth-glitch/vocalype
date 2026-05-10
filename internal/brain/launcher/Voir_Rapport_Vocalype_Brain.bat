@echo off
setlocal
title Vocalype Brain - Rapport
set "REPO_ROOT=C:\developer\sas\vocalype"
cd /d "%REPO_ROOT%"
echo Ouverture du rapport Vocalype Brain...
echo.
start "" "internal/brain\outputs\night_shift_report.md"
python internal/brain\scripts\review_night_shift.py
echo.
echo Termine. Tu peux fermer cette fenetre.
pause

