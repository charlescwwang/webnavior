@echo off
setlocal
cd /d "%~dp0"
echo Testing OpenVINO on the Intel GPU, FP32 then FP16.
echo This does not open the microphone or change calibration. Please wait.
"%~dp0resources\audio\python\python.exe" -B -u "%~dp0diagnoseAudio.py" --audio-root "%~dp0resources\audio" --candidate-denoiser "%~dp0resources\audio\src\uma8_frontend\denoise.py" --reference "%~dp0openvinoReference.npz" --sweep --report "%~dp0OpenVINO-GPU-Test.json"
echo.
echo Please provide OpenVINO-GPU-Test.json. Details are in openvino-test-*.
pause
