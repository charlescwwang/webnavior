@echo off
setlocal
cd /d "%~dp0"
echo Close the Kiosk EXE first. Keep speakers silent during this test.
echo Hush runs locally on CPU. Then speak naturally for 15 seconds.
echo This test saves timing metrics only, not recordings or settings.
"%~dp0resources\audio\python\python.exe" -B -u "%~dp0probeNativePipeline.py" --audio-root "%~dp0resources\audio" --report "%~dp0Hush-Audio-Test.json"
echo.
echo Please provide Hush-Audio-Test.json.
pause
