@echo off
cd /d "%~dp0"
echo Native eight-channel capture test. Close the Kiosk EXE first.
echo Speak for five seconds. This test saves metrics only, not recordings.
"%~dp0resources\audio\python\python.exe" -B -u "%~dp0probeNativeCapture.py" --audio-root "%~dp0resources\audio" --report "%~dp0Native-Capture-Test.json"
echo Report: %~dp0Native-Capture-Test.json
pause
