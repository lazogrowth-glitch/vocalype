@echo off
chcp 65001 >nul
setlocal
title Vocalype Brain — Stop
set "REPO=C:\developer\sas\vocalype"
cd /d "%REPO%"

echo ============================================================
echo   VOCALYPE BRAIN — ARRÊT
echo ============================================================
echo.
echo Vocalype Brain n'a pas de daemon ou de processus persistant
echo en arrière-plan en Mode Opérationnel.
echo.
echo Chaque script se lance, fait son travail, et se termine.
echo Il n'y a rien à "stopper" automatiquement.
echo.
echo SI tu vois une fenêtre de terminal Brain encore ouverte,
echo tu peux la fermer manuellement en appuyant sur une touche
echo ou en fermant la fenêtre.
echo.
echo SI tu veux arrêter le processus Vocalype (l'app dictée),
echo utilise le menu système de l'app Vocalype, pas ce script.
echo Ce script ne touche PAS à l'application Vocalype.
echo.
echo ============================================================
echo.
pause
