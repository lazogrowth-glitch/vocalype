@echo off
echo Clearing Windows icon cache...
taskkill /f /im explorer.exe >nul 2>&1
del /f /q "%localappdata%\IconCache.db" >nul 2>&1
del /f /q "%localappdata%\Microsoft\Windows\Explorer\iconcache_*.db" >nul 2>&1
del /f /q "%localappdata%\Microsoft\Windows\Explorer\thumbcache_*.db" >nul 2>&1
echo Done. Restarting Explorer...
start explorer.exe
echo Icon cache cleared!
