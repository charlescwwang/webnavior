"""Real CPU DSP diagnostic tests; only the external PortAudio boundary is simulated."""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import probeNativePipeline

ROOT = Path(__file__).resolve().parents[2]
AUDIO = ROOT/'apps/stage-kiosk-desktop/audio'


class InputStream:
    def __init__(self, callback, **options):
        self.callback = callback
        self.active = False
        self.closed = threading.Event()
    def start(self):
        self.active = True
        self.thread = threading.Thread(target=self.run)
        self.thread.start()
    def run(self):
        import numpy as np
        tick = 0
        deadline = time.perf_counter()
        while not self.closed.is_set():
            t = (np.arange(480)+tick*480)/48000
            voice = (.03*np.sin(2*np.pi*185*t)).astype(np.float32)
            self.callback(np.tile(voice[:, None], (1, 8)), 480, None, False)
            tick += 1
            deadline += .01
            self.closed.wait(max(0, deadline-time.perf_counter()))
    def abort(self):
        self.closed.set()
        self.thread.join(timeout=2)
        self.active = False
    def close(self):
        self.closed.set()


class PortAudio:
    PortAudioError = RuntimeError
    def query_hostapis(self):
        return [dict(name='Windows WASAPI', default_output_device=-1)]
    def query_devices(self):
        return [dict(name='UMA-8 RAW', hostapi=0, max_input_channels=8, max_output_channels=0)]
    def check_input_settings(self, **options):
        pass
    def InputStream(self, **options):
        return InputStream(**options)


@unittest.skipUnless(os.environ.get('KIOSK_AUDIO_TEST_PYTHON'), 'Explicit CPU DSP validation environment required')
class PipelineDiagnosticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        global AUDIO
        source = AUDIO
        cls.runtime = tempfile.TemporaryDirectory(prefix='hush-diagnostic-')
        AUDIO = Path(cls.runtime.name)/'audio'
        shutil.copytree(source, AUDIO, ignore=shutil.ignore_patterns('__pycache__', 'tests', '*.pyc'))
        files = {str(p.relative_to(AUDIO)): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in AUDIO.rglob('*') if p.is_file()}
        (AUDIO/'AUDIO-MANIFEST.json').write_text(json.dumps(dict(files=files)))

    @classmethod
    def tearDownClass(cls):
        cls.runtime.cleanup()

    def options(self, report):
        return argparse.Namespace(audio_root=AUDIO, report=report, input_device='',
                                  channels=list(range(7)), gain_db=0, seconds=.5)
    def test_real_worker_reports_full_pipeline_timings_without_profile_writes(self):
        import sys
        sys.path.insert(0, str(AUDIO/'src'))
        from uma8_frontend import native_device
        original = json.loads((AUDIO/'AUDIO-MANIFEST.json').read_text())['files']
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory)/'result.json'
            with patch.object(native_device, 'portaudio', return_value=PortAudio()):
                status = probeNativePipeline.measure(self.options(report))
            result = json.loads(report.read_text())
            self.assertEqual(status, 0)
            self.assertTrue(result['success'])
            self.assertEqual(result['stage'], 'completed')
            self.assertEqual(result['diagnostics']['requested_provider'], 'CPU')
            self.assertGreaterEqual(result['processedFrames'], 24000)
            self.assertGreater(result['outputSamples'], 5000)
            for key in ('spatial16ms', 'hush10ms', 'frontend10ms', 'read16ms'):
                self.assertGreater(result['timing'][key]['calls'], 0)
                self.assertGreater(result['timing'][key]['meanMs'], 0)
            self.assertFalse(result['audioSaved'])
            self.assertFalse(result['existingProfileModified'])
            self.assertFalse(result['asrRequested'])
            self.assertEqual(list(Path(directory).iterdir()), [report])
        for name, expected in original.items():
            self.assertEqual(hashlib.sha256((AUDIO/name).read_bytes()).hexdigest(), expected)
    def test_device_open_failure_keeps_its_stage_and_actual_error(self):
        import sys
        sys.path.insert(0, str(AUDIO/'src'))
        from uma8_frontend import native_device
        class UnsupportedInput(PortAudio):
            def check_input_settings(self, **options):
                raise RuntimeError('Unsupported native 48000 Hz input')
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory)/'result.json'
            with patch.object(native_device, 'portaudio', return_value=UnsupportedInput()):
                status = probeNativePipeline.measure(self.options(report))
            result = json.loads(report.read_text())
            self.assertEqual(status, 1)
            self.assertEqual(result['stage'], 'native-open')
            self.assertIn('Unsupported native', result['error']['message'])
    def test_slow_inference_retains_timing_and_does_not_report_success(self):
        import sys
        sys.path.insert(0, str(AUDIO/'src'))
        from uma8_frontend import native_device
        from uma8_frontend.hush import Session
        original = Session.process
        # NOTICE: delay the external model boundary but keep real CPU inference,
        # AEC, native callback queue, DSP and error reporting intact.
        def slow(instance, spectrum):
            time.sleep(.3)
            return original(instance, spectrum)
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory)/'result.json'
            with patch.object(native_device, 'portaudio', return_value=PortAudio()), patch.object(Session, 'process', slow):
                status = probeNativePipeline.measure(self.options(report))
            result = json.loads(report.read_text())
            self.assertEqual(status, 1)
            self.assertFalse(result['success'])
            self.assertEqual(result['stage'], 'native-pipeline-capture')
            self.assertGreater(result['timing']['hush10ms']['maxMs'], 250)
            self.assertIn('250 ms backlog', result['error']['message'])


class PipelineGuardTests(unittest.TestCase):
    def test_cli_supervisor_preserves_the_child_failure_report(self):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory)/'result.json'
            result = subprocess.run([sys.executable, '-B', str(Path(probeNativePipeline.__file__)),
                                     '--audio-root', directory, '--report', str(report)],
                                    capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 1)
            data = json.loads(report.read_text())
            self.assertEqual(data['stage'], 'source-check')
            self.assertFalse(data['success'])
            self.assertFalse(data['existingProfileModified'])
    def test_mismatched_installed_source_fails_before_native_capture(self):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory)/'result.json'
            args = argparse.Namespace(audio_root=Path(directory), report=report,
                                      input_device='', channels=list(range(7)), gain_db=30, seconds=15)
            self.assertEqual(probeNativePipeline.measure(args), 1)
            result = json.loads(report.read_text())
            self.assertEqual(result['stage'], 'source-check')
            self.assertFalse(result['success'])
            self.assertNotIn('diagnostics', result)


if __name__ == '__main__':
    unittest.main()
