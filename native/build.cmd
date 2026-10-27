@echo off
rem Compila proc-audio.exe com o MSVC (precisa do Visual Studio com "Desenvolvimento para desktop com C++").
setlocal
set "PATH=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer;%PATH%"
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VS=%%i"
if not defined VS (
  echo Visual Studio com C++ nao encontrado.
  exit /b 1
)
call "%VS%\VC\Auxiliary\Build\vcvars64.bat" >nul || exit /b 1
if not exist "%~dp0bin" mkdir "%~dp0bin"
cl /nologo /O2 /EHsc /std:c++17 /W4 /utf-8 "%~dp0proc-audio.cpp" /Fe"%~dp0bin\proc-audio.exe" /Fo"%~dp0bin\\" ole32.lib mmdevapi.lib user32.lib || exit /b 1
echo OK: %~dp0bin\proc-audio.exe
