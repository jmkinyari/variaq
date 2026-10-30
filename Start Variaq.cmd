@echo off
title Variaq server
cd /d "%~dp0"
if exist "C:\Program Files\nodejs\node.exe" set "PATH=C:\Program Files\nodejs;%PATH%"
rem Clear a system-wide NODE_ENV (e.g. "production") so development mode works.
set NODE_ENV=
if not exist node_modules (echo Installing packages... & call npm install)
if not exist data\variaq.db (call npm run setup & call npm run seed)
echo Variaq is starting at http://localhost:3000  - close this window to stop it.
npm run dev
