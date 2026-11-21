@echo off
REM ===========================================================================
REM  Meeting Assistant - Uninstall (launcher only)
REM
REM  Removes Meeting Assistant. Your meetings and notes are kept.
REM  Runs MeetingAssistant.ps1 beside this file. No administrator rights are
REM  needed: the app is installed for your Windows user only.
REM ===========================================================================
setlocal
set "PS1=%~dp0MeetingAssistant.ps1"

if not exist "%PS1%" (
    echo [ERROR] Missing "%PS1%"
    pause
    exit /b 2
)

REM ExecutionPolicy Bypass applies to this one child process only; nothing machine-wide changes.
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Action Uninstall %*
set "RC=%ERRORLEVEL%"
echo.
if not defined MEETING_ASSISTANT_NOPAUSE pause
exit /b %RC%
