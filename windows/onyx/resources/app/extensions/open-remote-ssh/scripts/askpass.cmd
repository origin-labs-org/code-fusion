@echo off
REM SSH_ASKPASS script for qoder remote-ssh extension (Windows)
REM This script is called by SSH when it needs password/passphrase input
REM It communicates with VS Code through a Named Pipe

REM Debug output to stderr
echo DEBUG: askpass.cmd called 1>&2
echo DEBUG: Arguments: %* 1>&2

REM The prompt text is passed as argument
REM Note: SSH may escape non-ASCII characters as octal sequences
set "PROMPT=%~1"

if not defined PROMPT (
    echo ERROR: No prompt provided 1>&2
    exit /b 1
)

echo DEBUG: PROMPT=%PROMPT% 1>&2

REM Check environment variables
if not defined VSCODE_SSH_ASKPASS_HANDLE (
    echo ERROR: VSCODE_SSH_ASKPASS_HANDLE not set 1>&2
    exit /b 1
)

echo DEBUG: VSCODE_SSH_ASKPASS_HANDLE=%VSCODE_SSH_ASKPASS_HANDLE% 1>&2

if not defined VSCODE_SSH_ASKPASS_NODE (
    echo ERROR: VSCODE_SSH_ASKPASS_NODE not set 1>&2
    exit /b 1
)

echo DEBUG: VSCODE_SSH_ASKPASS_NODE=%VSCODE_SSH_ASKPASS_NODE% 1>&2

if not defined VSCODE_SSH_ASKPASS_MAIN (
    echo ERROR: VSCODE_SSH_ASKPASS_MAIN not set 1>&2
    exit /b 1
)

echo DEBUG: VSCODE_SSH_ASKPASS_MAIN=%VSCODE_SSH_ASKPASS_MAIN% 1>&2

REM Call Node.js script to communicate with VS Code and get the password
echo DEBUG: Calling Node.js script... 1>&2
"%VSCODE_SSH_ASKPASS_NODE%" "%VSCODE_SSH_ASKPASS_MAIN%" "%PROMPT%" "%VSCODE_SSH_ASKPASS_HANDLE%"
exit /b %ERRORLEVEL%

