@echo off
REM Window Seat - double-click to run. First run sets everything up (about a minute).
title Window Seat
cd /d "%~dp0"

set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY (
  echo Python is not installed. Get it from https://www.python.org/downloads/
  echo During setup, tick "Add python.exe to PATH". Then double-click start.bat again.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Setting up for the first time...
  %PY% -m venv .venv || goto :fail
)

REM Reinstall only when pyproject.toml has changed since the last install
for %%F in (pyproject.toml) do set "STAMP=%%~tF %%~zF"
set "OLD="
if exist ".venv\installed.txt" set /p OLD=<".venv\installed.txt"
if not "%OLD%"=="%STAMP%" (
  echo Installing dependencies...
  ".venv\Scripts\python.exe" -m pip install --quiet --upgrade pip
  ".venv\Scripts\python.exe" -m pip install --quiet -e . || goto :fail
  > ".venv\installed.txt" echo %STAMP%
)

if "%~1"=="" (
  ".venv\Scripts\python.exe" -m windowseat.cli start
) else (
  REM A file was dropped onto start.bat: copy it to flights\ and run the menu
  if not exist flights mkdir flights
  copy /y "%~1" flights\ >nul
  ".venv\Scripts\python.exe" -m windowseat.cli start
)
pause
exit /b 0

:fail
echo.
echo Something went wrong during setup. Scroll up for the error message.
pause
exit /b 1
