@echo off
cd /d "%~dp0"
echo Starting Ballclub at http://localhost:5173
start "" http://localhost:5173
node tools\serve.mjs
pause
