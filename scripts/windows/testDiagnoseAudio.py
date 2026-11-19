"""Diagnostic reporting tests; no GPU device or microphone is simulated."""
import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("diagnoseAudio", Path(__file__).with_name("diagnoseAudio.py"))
diagnoseAudio = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnoseAudio)


class DiagnosticTests(unittest.TestCase):
    def test_preserves_localized_native_error_hidden_by_utf8_decoder(self):
        raw = b"x" * 285 + "參數錯誤".encode("cp950")
        try:
            raw.decode("utf-8")
        except UnicodeDecodeError as error:
            details = diagnoseAudio.describe_error(error, "cp950")
        self.assertEqual(details["type"], "UnicodeDecodeError")
        self.assertEqual(details["decodeFailure"]["start"], 285)
        self.assertEqual(details["decodeFailure"]["rawHex"], raw.hex())
        self.assertIn("參數錯誤", details["decodeFailure"]["windowsAnsiText"])

    def test_retains_invalid_ansi_bytes_without_changing_model_success(self):
        raw = b"\x81"
        try:
            raw.decode("utf-8")
        except UnicodeDecodeError as error:
            details = diagnoseAudio.describe_error(error, "cp950")
        self.assertEqual(details["decodeFailure"]["rawHex"], "81")
        self.assertEqual(details["decodeFailure"]["windowsAnsiText"], "\\x81")
        self.assertNotIn("success", details)

    def test_keeps_normal_initialization_errors(self):
        details = diagnoseAudio.describe_error(RuntimeError("DirectML unavailable"))
        self.assertEqual(details, {"type": "RuntimeError", "message": "DirectML unavailable"})

    def test_retains_original_native_bytes_when_cleanup_raises_another_error(self):
        raw = b"DirectML: " + "參數錯誤".encode("cp950")
        try:
            try:
                raw.decode("utf-8")
            finally:
                raise PermissionError(32, "profile file is still in use")
        except PermissionError as error:
            details = diagnoseAudio.describe_error(error, "cp950")
        original = details["chainedErrors"][0]
        self.assertEqual(original["type"], "UnicodeDecodeError")
        self.assertEqual(original["decodeFailure"]["rawHex"], raw.hex())
        self.assertEqual(original["decodeFailure"]["windowsAnsiText"], "DirectML: 參數錯誤")

    @unittest.skipUnless(os.environ.get("KIOSK_AUDIO_TEST_PYTHON") and os.name != "nt",
                         "Requires the explicit Linux CPU model validation environment")
    def test_real_probe_reports_openvino_cpu_and_gpu_failure_separately(self):
        root = Path(__file__).resolve().parents[2]
        script = Path(__file__).with_name("diagnoseAudio.py")
        with tempfile.TemporaryDirectory() as directory:
            for provider in ("cpu", "openvino"):
                with self.subTest(provider=provider):
                    report = Path(directory) / (provider + ".json")
                    result = subprocess.run(
                        [os.environ["KIOSK_AUDIO_TEST_PYTHON"], str(script),
                         "--audio-root", str(root / "apps/stage-kiosk-desktop/audio"),
                         "--candidate-denoiser", str(root / "apps/stage-kiosk-desktop/audio/src/uma8_frontend/denoise.py"),
                         "--report", str(report), "--provider", provider],
                        capture_output=True, timeout=30,
                    )
                    data = json.loads(report.read_text(encoding="utf-8"))
                    self.assertIn("openvino", data)
                    self.assertFalse(data["microphoneRequested"])
                    self.assertFalse(data["existingProfileModified"])
                    if provider == "cpu":
                        self.assertEqual(result.returncode, 0)
                        self.assertTrue(data["success"])
                        self.assertNotIn("error", data)
                        self.assertFalse(data["diagnostics"]["gpu_verified"])
                        self.assertEqual(data["timing"]["frames"], 1024)
                        self.assertGreater(data["timing"]["meanMs"], 0)
                        self.assertIn("candidateSha256", data)
                    else:
                        self.assertEqual(result.returncode, 1)
                        self.assertFalse(data["success"])
                        self.assertEqual(data["error"]["type"], "RuntimeError")
                        self.assertIn("GPU", data["error"]["message"])


if __name__ == "__main__":
    unittest.main()
