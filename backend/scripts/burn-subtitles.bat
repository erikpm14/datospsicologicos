@echo off
REM Wrapper para ffmpeg que maneja correctamente las rutas en Windows
REM Uso: burn-subtitles.bat "video.mp4" "subtitles.vtt" "output.mp4"

setlocal enabledelayedexpansion

set VIDEO=%~1
set SUBTITLES=%~2
set OUTPUT=%~3

REM Convertir backslashes a forward slashes para ffmpeg (funciona en Windows también)
set VIDEO_FIXED=%VIDEO:\=/%
set SUBTITLES_FIXED=%SUBTITLES:\=/%
set OUTPUT_FIXED=%OUTPUT:\=/%

REM Ejecutar ffmpeg con rutas convertidas
ffmpeg -i "%VIDEO_FIXED%" -vf "subtitles=%SUBTITLES_FIXED%" -c:a copy -shortest "%OUTPUT_FIXED%" -y

if %ERRORLEVEL% EQU 0 (
  echo Subtitles burned successfully
  exit /b 0
) else (
  echo ffmpeg failed with error code %ERRORLEVEL%
  exit /b 1
)
