@echo off
rem Opens Talaria's setup window even when everything is installed: to add MiKTeX or the browser for
rem applications later, or to repair something. Talaria.bat opens it by itself when something is missing.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" -Show
