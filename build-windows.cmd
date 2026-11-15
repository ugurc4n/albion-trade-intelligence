@echo off
rem Double-click to build the Windows installer (Setup.exe) on this PC.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-windows.ps1"
