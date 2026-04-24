@echo off
setlocal
title Vocalype Brain - Stop
set "REPO_ROOT=C:\developer\sas\vocalype"
cd /d "%REPO_ROOT%"
echo stop_requested>"vocalype-brain\data\stop_night_shift.request"
echo Demande d'arret envoyee. Vocalype Brain va s'arreter apres le cycle en cours.
echo.
pause
