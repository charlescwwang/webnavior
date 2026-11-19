"""Five-second check of the application's input-only device boundary, without GPU or saved PCM."""
import argparse
import json
from pathlib import Path
import sys
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audio-root', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--input-device', default='')
    args = parser.parse_args()
    result = dict(success=False, capture='sounddevice/PortAudio', sampleRate=48000,
                  inputChannels=8, outputChannels=0, audioSaved=False, gpuTested=False)
    capture = None
    try:
        sys.path.insert(0, str(args.audio_root.resolve() / 'src'))
        import numpy as np
        from uma8_frontend.native_device import Capture, devices
        result['devices'] = devices()
        capture = Capture(args.input_device)
        result.update(inputDevice=capture.input_id)
        print('Speak naturally at the ordering position for five seconds. No recording is saved.', flush=True)
        count = 0
        power = np.zeros(8, np.float64)
        peak = np.zeros(8, np.float32)
        deadline = time.monotonic()+12
        while count < 48000*5:
            if time.monotonic() > deadline:
                raise TimeoutError('Native audio did not deliver five seconds before timeout')
            # No application playback is started by this input-only diagnostic.
            capture.render(np.zeros((384, 2), np.float32))
            raw = capture.read()[:, :8]
            if len(raw):
                if not np.isfinite(raw).all():
                    raise ValueError('Native microphone returned nonfinite PCM')
                power += np.sum(raw.astype(np.float64)**2, axis=0)
                peak = np.maximum(peak, np.max(abs(raw), axis=0))
                count += len(raw)
            time.sleep(.008)
        rms = np.sqrt(power/count)
        result.update(success=True, capturedFrames=count, seconds=count/48000,
                      rms=rms.tolist(), peak=peak.tolist(),
                      firstSevenHaveSignal=bool(np.all(rms[:7] > 1e-6)))
    except Exception as error:
        result.update(error=str(error), errorType=type(error).__name__)
    finally:
        if capture is not None:
            try:
                capture.close()
            except Exception as error:
                result.update(success=False, error=str(error), errorType=type(error).__name__)
    args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
    return 0 if result['success'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
