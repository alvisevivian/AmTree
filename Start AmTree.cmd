@echo off
setlocal
cd /d "%~dp0"
set "AMTREE_PY=python"
py -3.13 -c "pass" >nul 2>&1 && set "AMTREE_PY=py -3.13"
%AMTREE_PY% -c "import sys; assert sys.version_info[:2] == (3, 13) and sys.maxsize > 2**32" >nul 2>&1
if errorlevel 1 (
  echo This offline bundle needs 64-bit Python 3.13.
  pause
  exit /b 1
)
%AMTREE_PY% -c "import sys; sys.path.insert(0, 'Backend/.deps'); import spiceypy, PIL" >nul 2>&1
if errorlevel 1 (
  %AMTREE_PY% -m pip install --no-index --find-links "Backend/wheels" --upgrade --target "Backend/.deps" spiceypy==8.4.0 pillow==12.1.1
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
%AMTREE_PY% -B "Backend/mission_server.py" --open-browser
if errorlevel 1 pause
