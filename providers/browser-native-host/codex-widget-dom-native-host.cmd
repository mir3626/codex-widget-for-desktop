@echo off
setlocal
set "SCRIPT=%~dp0native-host.mjs"
set "BUNDLED_NODE=%~dp0..\..\dist\node-runtime\node.exe"

if exist "%BUNDLED_NODE%" (
  "%BUNDLED_NODE%" "%SCRIPT%"
) else (
  node "%SCRIPT%"
)
