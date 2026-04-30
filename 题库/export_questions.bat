@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

echo Export mode: student / answer / detail
set /p "MODE=Mode: "
echo Enter tags separated by spaces. Example: 高一 上学期 期中 动量
set /p "TAGS=Tags: "
set /p "SOURCE=Source keyword, optional: "
set /p "OUT=Output file name, for example exports\export.md: "

set "ARGS="
for %%T in (%TAGS%) do set "ARGS=!ARGS! --tag %%T"
if not "%SOURCE%"=="" set "ARGS=%ARGS% --source %SOURCE%"
if "%OUT%"=="" set "OUT=exports\export.md"

E:\anaconda\python.exe bank_tool.py --vault "D:\obrepo\papers\题库" export --mode %MODE% %ARGS% --out "%OUT%"
pause
