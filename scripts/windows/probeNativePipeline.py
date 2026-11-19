"""Measure the installed 0.6.0 native pipeline in isolation; no profile writes or ASR."""
import argparse
from collections import deque
import hashlib
import json
import locale
from pathlib import Path
import subprocess
import sys
import tempfile
import time

# Embedded Python's _pth omits the executable's companion scripts directory.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from diagnoseAudio import describe_error

# Installed source hashes are populated from the verified 0.6.0 release below.
EXPECTED_SOURCE = {
    "src/uma8_frontend/native_device.py": "8f805dbc0f2976631b0c6e4a3f5540deb527a9e6edb54f370e6805dbe4689321",
    "src/uma8_frontend/worker.py": "1a4af6b9d382b008d6d48072c79ca56bfd9174b13f7c1d3a97abf519f91dc3b4",
    "src/uma8_frontend/pipeline.py": "5383f974bc95f5d732015692b6b41f64d86cd0adfa1dfcd4f65315189d5068c0",
    "src/uma8_frontend/beamforming.py": "8a9e1f3c99c5ae8a0c24b31fee67f02cfb42861f7a7aeff03bf755cabc58d466",
    "src/uma8_frontend/onlineRtf.py": "bdfcd4f52455c52457c5c709c2d88d2207c12df9bacb27877b44ed0ee2f9a221",
    "src/uma8_frontend/config.py": "791d92a8e75d45b331cd2f5d0fd6aed983421a022f3ddc73d9538c5c380af0a8",
    "src/uma8_frontend/denoise.py": "19aa4693db577cafe41c174f57f986aac187299740e21cafb19973cd739e999d",
    "src/uma8_frontend/aec.py": "1b688becf2d97bf0c66ac59dabcaf1e6d5e649e472a7befdefd5f08ca9d19349",
    "src/uma8_frontend/segment.py": "132489047289a9113515de231f36ead3e72258b33cbe4bf3dccbd1953757b33b",
    "src/uma8_frontend/resampling.py": "c82a4501a8a3e3879e9dd1d3f15ff73f2b3f75b669ee30f6e757d0ac18f3e01f"
}


def measure(args):
    """Run the same Worker/Capture/DSP with explicit silent playback reference.

    Each generation uses a temporary state directory. Method observers time the
    original DSP calls without changing their inputs, outputs or configuration.
    This excludes Chromium, Eventa and ASR; it cannot certify AEC during playback.
    """
    audio = args.audio_root.resolve()
    report = dict(success=False, stage='source-check', requestedProvider=args.provider,
                  existingProfileModified=False, installedFilesModified=False, audioSaved=False,
                  asrRequested=False, speakerPlayback=False, browserIpcTested=False,
                  playbackReference='explicit silence; keep all speakers silent',
                  secondsRequested=args.seconds, channels=args.channels, gainDb=args.gain_db,
                  inputDeviceRequested=args.input_device)
    worker = None
    timings = {}
    started = None
    poll_times = deque(maxlen=10000)
    scheduling_delays = deque(maxlen=10000)
    captured = 0
    segments = 0
    speech_frames = 0
    power = peak = None
    try:
        for relative, expected in EXPECTED_SOURCE.items():
            if hashlib.sha256((audio/relative).read_bytes()).hexdigest() != expected:
                raise ValueError('This test requires the unmodified 0.6.0 audio package: '+relative)
        report['modelSha256'] = hashlib.sha256((audio/'models/ulunas_stream.onnx').read_bytes()).hexdigest()
        sys.path.insert(0, str(audio/'src'))
        import numpy as np
        from uma8_frontend.worker import Worker
        power = np.zeros(8, np.float64)
        peak = np.zeros(8, np.float32)
        report['stage'] = 'model-initialization'
        with tempfile.TemporaryDirectory(prefix='kiosk-audio-pipeline-') as state:
            initial = time.perf_counter()
            worker = Worker(state, audio/'models/ulunas_stream.onnx', args.provider)
            report['initializationMs'] = (time.perf_counter()-initial)*1000
            diagnostics, _ = worker.handle(dict(kind='status'), b'')
            report['diagnostics'] = diagnostics
            report['stage'] = 'dsp-start'
            worker.handle(dict(kind='start', generation='diagnostic', channels=args.channels,
                               gainDb=args.gain_db), b'')
            for name, instance, method in (
                ('aec10ms', worker.frontend.aec, 'process'),
                ('spatial16ms', worker.frontend.beam, 'process'),
                ('denoise16ms', worker.frontend.denoise, 'process'),
            ):
                samples = deque(maxlen=10000)
                timings[name] = samples
                original = getattr(instance, method)
                def observed(*values, _original=original, _samples=samples, **keywords):
                    before = time.perf_counter()
                    try:
                        return _original(*values, **keywords)
                    finally:
                        _samples.append((time.perf_counter()-before)*1000)
                setattr(instance, method, observed)
            report['stage'] = 'native-open'
            worker.handle(dict(kind='open', generation='diagnostic', inputDevice=args.input_device), b'')
            report['inputDevice'] = worker.capture.input_id
            original_read = worker.capture.read
            def observe_input():
                nonlocal captured
                raw = original_read()
                if len(raw):
                    captured += len(raw)
                    power[:] += np.sum(raw[:, :8].astype(np.float64)**2, axis=0)
                    peak[:] = np.maximum(peak, np.max(abs(raw[:, :8]), axis=0))
                return raw
            worker.capture.read = observe_input
            report['stage'] = 'native-pipeline-capture'
            print('Speak naturally for '+str(args.seconds)+' seconds; keep speakers silent. No audio is saved.', flush=True)
            silence = np.zeros(768, np.float32).tobytes()
            started = time.perf_counter()
            next_poll = started
            render_offset = 0
            deadline = started+args.seconds+2
            while worker.offset < args.seconds*48000:
                now = time.perf_counter()
                if now > deadline:
                    raise TimeoutError('The full pipeline did not process the requested input before its deadline')
                if now < next_poll:
                    time.sleep(next_poll-now)
                before = time.perf_counter()
                scheduling_delays.append(max(0, before-next_poll)*1000)
                reply, pcm = worker.handle(dict(kind='poll', generation='diagnostic', offsetFrames=render_offset), silence)
                poll_times.append((time.perf_counter()-before)*1000)
                if not np.isfinite(pcm).all():
                    raise ValueError('Nonfinite pipeline output')
                render_offset += 384
                next_poll += .008
                segments += len(reply['segments'])
                speech_frames += sum(frame['length'] for frame in reply['frames'] if frame['speech'])
            report['success'] = True
            report['stage'] = 'completed'
    except Exception as error:
        report['error'] = describe_error(error, locale.getpreferredencoding(False))
    finally:
        if worker is not None:
            report['processedFrames'] = worker.offset
            report['outputSamples'] = worker.output_offset
            if worker.frontend is not None:
                timings['frontend10ms'] = worker.frontend.timings_ms
                report['tracking'] = worker.frontend.beam.tracker.statistics
            if started is not None:
                report['elapsedSeconds'] = time.perf_counter()-started
            try:
                worker.close_capture()
            except Exception as error:
                report['cleanupError'] = describe_error(error, locale.getpreferredencoding(False))
                report['success'] = False
        if power is not None:
            import numpy as np
            report['capturedFrames'] = captured
            report['inputRms'] = np.sqrt(power/max(1, captured)).tolist()
            report['inputPeak'] = peak.tolist()
            report['speechSamples'] = speech_frames
            report['completedSegments'] = segments
            timings['poll8ms'] = poll_times
            timings['pollSchedulingDelay'] = scheduling_delays
            report['timing'] = {}
            for name, samples in timings.items():
                if samples:
                    values = np.asarray(samples)
                    report['timing'][name] = dict(calls=len(samples), meanMs=float(np.mean(values)),
                                                 p95Ms=float(np.percentile(values, 95)), maxMs=float(np.max(values)),
                                                 totalMs=float(np.sum(values)))
            processed_ms = report.get('processedFrames', 0)/48
            report['processingDutyRatio'] = sum(poll_times)/processed_ms if processed_ms else None
        report['interpretation'] = ('A successful silent standalone run narrows investigation toward browser/IPC scheduling; '
                                    'this does not test browser playback, echo quality or ASR, and success alone is not realtime certification.')
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(dict(success=report['success'], stage=report['stage'], report=str(args.report)), ensure_ascii=True), flush=True)
    return 0 if report['success'] else 1


def main():
    """Bound native initialization in a child, preserving its report on failure."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audio-root', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--seconds', type=float, default=15)
    parser.add_argument('--input-device', default='')
    parser.add_argument('--channels', type=lambda value: [int(part) for part in value.split(',')], default=list(range(7)))
    parser.add_argument('--gain-db', type=float, default=30)
    parser.add_argument('--provider', choices=('openvino', 'cpu'), default='openvino', help='CPU is explicit developer validation only; never an automatic retry')
    parser.add_argument('--child', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not 0 < args.seconds <= 30:
        parser.error('--seconds must be in (0, 30]')
    if args.child:
        return measure(args)
    print('Close the Kiosk EXE and keep all speakers silent. Initial GPU compilation can take up to 180 seconds.', flush=True)
    with tempfile.TemporaryDirectory(prefix='kiosk-pipeline-supervisor-') as temporary:
        child_report = Path(temporary)/'report.json'
        command = [sys.executable, '-B', '-u', str(Path(__file__).resolve()), '--child',
                   '--audio-root', str(args.audio_root.resolve()), '--report', str(child_report),
                   '--seconds', str(args.seconds), '--input-device', args.input_device,
                   '--channels', ','.join(map(str, args.channels)), '--gain-db', str(args.gain_db), '--provider', args.provider]
        try:
            child = subprocess.run(command, timeout=185+args.seconds)
            if not child_report.is_file():
                raise RuntimeError('Native diagnostic exited without a report (exit '+str(child.returncode)+')')
            result = json.loads(child_report.read_text(encoding='utf-8'))
            if child.returncode:
                result['success'] = False
        except Exception as error:
            result = dict(success=False, stage='child-supervisor', error=describe_error(error),
                          existingProfileModified=False, installedFilesModified=False, audioSaved=False)
        args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print('Report: '+str(args.report), flush=True)
    return 0 if result['success'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
