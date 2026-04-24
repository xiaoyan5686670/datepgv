@echo off
set "ROOT=%~dp0"
start "datepgv-backend" /D "%ROOT%backend" cmd /k "echo Hello && pause"
