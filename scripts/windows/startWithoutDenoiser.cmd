@echo off
setlocal
cd /d "%~dp0"
echo Close all running Kiosk windows before starting this test.
echo UL-UNAS will be skipped only in this test process.
echo Native 8-channel input, AEC3, RTF/MVDR and speech segmentation remain enabled.
set "WEBNAVIOR_TEST_BYPASS_ULUNAS=1"
start "" /wait "%~dp0Webnavior Kiosk.exe"
endlocal
