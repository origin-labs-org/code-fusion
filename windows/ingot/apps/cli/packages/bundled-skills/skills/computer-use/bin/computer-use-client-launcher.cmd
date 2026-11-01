@echo off
setlocal EnableExtensions

set "QODER_HOME_EFFECTIVE=%QODER_HOME%"
if "%QODER_HOME_EFFECTIVE%"=="" set "QODER_HOME_EFFECTIVE=%USERPROFILE%\.qoder"
set "QODER_CUA_CLIENT=%QODER_HOME_EFFECTIVE%\bin\qoder-computer-use\QoderComputerUse.exe"
set "QODER_CUA_LEGACY_CLIENT=%QODER_HOME_EFFECTIVE%\bin\qoder-computer-use\1.0.1\QoderComputerUse.exe"
if not exist "%QODER_CUA_CLIENT%" set "QODER_CUA_CLIENT=%QODER_CUA_LEGACY_CLIENT%"

if not exist "%QODER_CUA_CLIENT%" (
  echo Qoder Computer Use client was not found in the current or legacy shared runtime directory. 1>&2
  exit /b 1
)

set "QODER_CUA_LOG_MODE=ide"
set "QODER_CUA_IDE_PRODUCT=Qoder"
set "QODER_CUA_LOG_LEVEL=info"

"%QODER_CUA_CLIENT%" %*
exit /b %ERRORLEVEL%
