@echo off
title PEGASO - Agente Nativo de Control Remoto y Archivos para Windows
cls
echo ====================================================================
echo    PEGASO - AGENTE NATIVO DE SOPORTE Y CONTROL REMOTO (WINDOWS)
echo ====================================================================
echo.
echo  [+] Control de Mouse Preciso (Soporte DPI Windows)
echo  [+] Teclado Nativo Completo (Teclas de Funcion, Atajos, Caracteres)
echo  [+] Explorador Remoto de Archivos (Subir, Descargar, Crear, Borrar)
echo.

if not exist "%~dp0agent.py" (
    echo  [!] No se encontro 'agent.py' localmente.
    echo  Descargando componente nativo desde el servidor GitHub...
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; try { (New-Object System.Net.WebClient).DownloadFile('https://depcapc19-dotcom.github.io/pcapc/agent.py', '%~dp0agent.py'); write-host '[+] agent.py descargado con exito.' } catch { (New-Object System.Net.WebClient).DownloadFile('https://raw.githubusercontent.com/depcapc19-dotcom/pcapc/main/agent.py', '%~dp0agent.py') }"
    echo.
)

echo  Iniciando agente en puerto 9999...
echo  Manten esta ventana abierta mientras realizas la sesion de soporte.
echo ====================================================================
echo.

where py >nul 2>nul
if %errorlevel% equ 0 (
    py "%~dp0agent.py"
    goto end
)

where python >nul 2>nul
if %errorlevel% equ 0 (
    python "%~dp0agent.py"
    goto end
)

echo [ERROR] No se pudo encontrar Python en el sistema.
echo Por favor instala Python desde https://www.python.org/ (asegurate de marcar "Add Python to PATH").
echo.
pause

:end
