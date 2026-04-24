@echo off
setlocal
title Vocalype Brain - Night Shift
set "REPO_ROOT=C:\developer\sas\vocalype"
cd /d "%REPO_ROOT%"
echo Demarrage de Vocalype Brain...
echo.
echo Night Shift en cours...
python vocalype-brain\scripts\night_shift.py
echo.
echo Rapport final...
python vocalype-brain\scripts\review_night_shift.py
echo.
echo Termine. Tu peux fermer cette fenetre.
pause
