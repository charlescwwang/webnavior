"""Assemble the pinned Windows audio runtime from verified local downloads.

No pip or downloader runs on the Kiosk. wheels retain their license and dist-info
files; Python's isolated path excludes any system Python or user site-packages.
"""
import argparse
import hashlib
import json
import shutil
import struct
import subprocess
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'apps/stage-kiosk-desktop/audio'


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def extract(archive, destination, *, wheel=False):
    """Reject traversal and unsupported wheel install schemes before writing."""
    with zipfile.ZipFile(archive) as source:
        for info in source.infolist():
            parts = PurePosixPath(info.filename).parts
            if not parts or info.is_dir():
                continue
            if '\\' in info.filename or PurePosixPath(info.filename).is_absolute() or '..' in parts:
                raise ValueError('Unsafe runtime archive path')
            base = destination
            if wheel and parts[0].endswith('.data'):
                if len(parts) < 3 or parts[1] not in ('purelib', 'platlib', 'data', 'scripts', 'headers'):
                    raise ValueError(f'Unsupported wheel install scheme: {info.filename}')
                if parts[1] == 'data':
                    base = destination.parents[1]
                elif parts[1] in ('scripts', 'headers'):
                    base = destination.parents[1] / ('Scripts' if parts[1] == 'scripts' else 'Include')
                parts = parts[2:]
            target = base.joinpath(*parts)
            if target.exists():
                raise ValueError(f'Overlapping runtime asset: {target}')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.read(info))


def prepare(python_zip, wheel_directory, output, vc_redist, bsdtar):
    manifest = json.loads((SOURCE / 'windowsRuntime.json').read_text())
    downloads = [(python_zip, manifest['python']['sha256'])]
    downloads += [(wheel_directory / item['file'], item['sha256']) for item in manifest['wheels']]
    downloads += [(vc_redist, manifest['visualCpp']['sha256'])]
    for path, expected in downloads:
        if digest(path) != expected:
            raise ValueError(f'Pinned runtime SHA256 mismatch: {path.name}')
    if digest(SOURCE / 'models/ulunas_stream.onnx') != manifest['modelSha256']:
        raise ValueError('Pinned UL-UNAS model SHA256 mismatch')
    # A nonempty output is never removed implicitly: accidental paths stay safe.
    if output.exists() and any(output.iterdir()):
        raise ValueError('Choose a new or empty audio output directory')
    output.mkdir(parents=True, exist_ok=True)
    runtime = output / 'python'
    extract(python_zip, runtime)
    for item in manifest['wheels']:
        path = wheel_directory / item['file']
        extract(path, runtime / 'Lib/site-packages', wheel=True)
    # sounddevice's Windows wheel also ships x86/ARM/macOS binaries. This
    # portable application is x64; retain both x64 variants plus their licenses.
    audio_binaries = runtime / 'Lib/site-packages/_sounddevice_data/portaudio-binaries'
    for name in ('libportaudio32bit.dll', 'libportaudio32bit-asio.dll',
                 'libportaudioarm64.dll', 'libportaudioarm64-asio.dll', 'libportaudio.dylib'):
        (audio_binaries / name).unlink()
    for name in ('libportaudio64bit.dll', 'libportaudio64bit-asio.dll'):
        if not (audio_binaries / name).is_file():
            raise ValueError(f'PortAudio runtime asset is missing: {name}')
    # The signed Microsoft redistributable contains WiX-attached cabinets.
    # The pinned archive/hash fixes their offsets and names; only the x64 CRT
    # DLLs needed by OpenVINO are copied. Nothing is installed system-wide.
    vc = manifest['visualCpp']
    archive = vc_redist.read_bytes()
    offset = vc['attachedCabOffset']
    size = struct.unpack_from('<I', archive, offset+8)[0]
    attached = archive[offset:offset+size]
    if hashlib.sha256(attached).hexdigest() != vc['attachedCabSha256']:
        raise ValueError('Microsoft attached cabinet hash mismatch')
    with tempfile.TemporaryDirectory(prefix='kiosk-vc-') as temporary:
        cab = Path(temporary) / 'attached.cab'
        cab.write_bytes(attached)
        minimum = subprocess.check_output([bsdtar, '-xOf', str(cab), vc['minimumCab']])
        cab.write_bytes(minimum)
        for name, expected in vc['files'].items():
            data = subprocess.check_output([bsdtar, '-xOf', str(cab), name+'_amd64'])
            if hashlib.sha256(data).hexdigest() != expected:
                raise ValueError(f'Microsoft CRT DLL hash mismatch: {name}')
            (runtime / name).write_bytes(data)
    license_data = subprocess.check_output([bsdtar, '-xOf', str(vc_redist), vc['licenseSource']])
    if hashlib.sha256(license_data).hexdigest() != vc['licenseSha256']:
        raise ValueError('Microsoft redistributable license hash mismatch')
    (runtime / 'Microsoft-Visual-Cpp-LICENSE.rtf').write_bytes(license_data)
    (runtime / 'python313._pth').write_text('python313.zip\n.\nLib/site-packages\n../src\nimport site\n', encoding='ascii')
    shutil.copytree(SOURCE / 'src', output / 'src', ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    shutil.copytree(SOURCE / 'models', output / 'models')
    shutil.copy2(SOURCE / 'windowsRuntime.json', output)
    shutil.copy2(SOURCE / 'README.md', output)
    # Native packages must be Windows x64 PE files, including every transitive
    # numerical library and OpenVINO plugins. This is structural, not execution proof.
    binaries = list(runtime.rglob('*.pyd')) + list(runtime.rglob('*.dll')) + list(runtime.glob('*.exe'))
    for path in binaries:
        data = path.read_bytes()
        offset = struct.unpack_from('<I', data, 0x3c)[0]
        if data[:2] != b'MZ' or data[offset:offset+4] != b'PE\0\0' or struct.unpack_from('<H', data, offset+4)[0] != 0x8664:
            raise ValueError(f'Not a Windows x64 binary: {path}')
    for name in ('openvino.dll', 'openvino_intel_gpu_plugin.dll', 'openvino_intel_cpu_plugin.dll', 'openvino_onnx_frontend.dll'):
        if not list(runtime.rglob(name)):
            raise ValueError(f'OpenVINO runtime asset is missing: {name}')
    if list(runtime.rglob('DirectML.dll')) or (runtime / 'Lib/site-packages/onnxruntime').exists():
        raise ValueError('The OpenVINO package must not contain ONNX Runtime/DirectML')
    result = dict(provider='OpenVINO', device='GPU.0', windowsPhysicalValidation=False,
                  source=manifest, nativeBinaries=len(binaries),
                  files={str(p.relative_to(output)): digest(p) for p in sorted(output.rglob('*')) if p.is_file()})
    (output / 'AUDIO-MANIFEST.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(dict(directory=str(output.resolve()), files=len(result['files']), nativeBinaries=len(binaries))))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--python-zip', type=Path, required=True)
    parser.add_argument('--wheel-dir', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--vc-redist', type=Path, required=True)
    parser.add_argument('--bsdtar', default='bsdtar')
    arguments = parser.parse_args()
    prepare(arguments.python_zip, arguments.wheel_dir, arguments.output_dir, arguments.vc_redist, arguments.bsdtar)
