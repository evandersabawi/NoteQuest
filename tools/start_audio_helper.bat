@echo off
title NoteQuest audio helper
cd /d "%~dp0.."
if not exist "tools\.venv\Scripts\python.exe" (
  echo The Python environment is missing. See README.md, "Lecture audio" section, for the one-time setup.
  pause
  exit /b 1
)
set PYTHONUTF8=1
"tools\.venv\Scripts\python.exe" "tools\audio_server.py"
echo.
echo The audio helper stopped. Press any key to close.
pause >nul
