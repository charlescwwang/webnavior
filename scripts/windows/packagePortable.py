"""Package the built Kiosk with the pinned official Windows runtime, without Node/pnpm on the target."""
import argparse
import hashlib
import json
import shutil
import struct
import subprocess
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VERSION = '46.0.0-alpha.2'
RUNTIME_SHA256 = '223a9d14517224f8724992cab13b0660ba34d85a9f2836cd632d11fa2f06b9d8'


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def package(runtime_zip, output, audio_runtime, reference):
    if digest(runtime_zip) != RUNTIME_SHA256:
        raise ValueError('Official Windows x64 runtime SHA256 mismatch; nothing was extracted.')
    outputs = ['main/index.js', 'preload/index.cjs', 'service/pb.js']
    built = ROOT / 'apps/stage-kiosk-desktop/out'
    for relative in outputs:
        if not (built / relative).is_file() or not (built / relative).stat().st_size:
            raise ValueError(f'Missing build output: {relative}; run the desktop build first.')
    if not reference.is_file():
        raise ValueError('The OpenVINO GPU qualification reference is required.')
    audio_manifest = json.loads((audio_runtime / 'AUDIO-MANIFEST.json').read_text())
    if audio_manifest['provider'] != 'OpenVINO' or audio_manifest['device'] != 'GPU.0':
        raise ValueError('The GPU package requires OpenVINO Intel GPU audio assets.')
    for relative, expected in audio_manifest['files'].items():
        path = (audio_runtime / relative).resolve()
        if not path.is_relative_to(audio_runtime.resolve()) or digest(path) != expected:
            raise ValueError(f'Audio runtime hash mismatch: {relative}')
    audio_source = ROOT / 'apps/stage-kiosk-desktop/audio'
    for source in (audio_source / 'src').rglob('*.py'):
        if digest(source) != digest(audio_runtime / source.relative_to(audio_source)):
            raise ValueError('Audio source changed after runtime preparation.')
    output.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().astimezone().strftime('%Y%m%d-%H%M%S')
    archive = output / f'Webnavior-Kiosk-GPU-Windows-x64-{stamp}.zip'
    with tempfile.TemporaryDirectory(prefix='webnavior-portable-') as temporary:
        app = Path(temporary) / 'Webnavior Kiosk'
        app.mkdir()
        with zipfile.ZipFile(runtime_zip) as source:
            # Validate every official archive path before extraction, even after the hash check.
            for name in source.namelist():
                target = (app / name).resolve()
                if not target.is_relative_to(app.resolve()):
                    raise ValueError('Runtime archive contains an unsafe path.')
            source.extractall(app)
        executable = app / 'electron.exe'
        pe = executable.read_bytes()
        pe_offset = struct.unpack_from('<I', pe, 0x3C)[0]
        if pe[:2] != b'MZ' or pe[pe_offset:pe_offset + 4] != b'PE\0\0' or struct.unpack_from('<H', pe, pe_offset + 4)[0] != 0x8664:
            raise ValueError('Runtime is not a Windows x64 executable.')
        executable.rename(app / 'Webnavior Kiosk.exe')
        if (app / 'electron_wer.dll').exists():
            (app / 'electron_wer.dll').rename(app / 'Webnavior Kiosk_wer.dll')
        (app / 'resources/default_app.asar').unlink(missing_ok=True)
        payload = app / 'resources/app'
        payload.mkdir(parents=True)
        app_version = json.loads((ROOT / 'apps/stage-kiosk-desktop/package.json').read_text())['version']
        (payload / 'package.json').write_text(json.dumps({'name': 'webnavior-kiosk', 'version': app_version, 'type': 'module', 'main': 'out/main/index.js'}), encoding='utf-8')
        for relative in outputs:
            target = payload / 'out' / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(built / relative, target)
        shutil.copy2(ROOT / 'scripts/windows/diagnoseAudio.py', app / 'diagnoseAudio.py')
        launcher = (ROOT / 'scripts/windows/testOpenVinoGpu.cmd').read_text(encoding='ascii')
        (app / 'Test OpenVINO GPU.cmd').write_bytes(launcher.replace('\n', '\r\n').encode('ascii'))
        shutil.copy2(reference, app / 'openvinoReference.npz')
        bypass_launcher = (ROOT / 'scripts/windows/startWithoutDenoiser.cmd').read_text(encoding='ascii')
        (app / 'Start Without UL-UNAS.cmd').write_bytes(bypass_launcher.replace('\n', '\r\n').encode('ascii'))
        shutil.copy2(ROOT / 'scripts/windows/probeNativeCapture.py', app / 'probeNativeCapture.py')
        native_launcher = (ROOT / 'scripts/windows/testNativeCapture.cmd').read_text(encoding='ascii')
        (app / 'Test Native Eight Channel.cmd').write_bytes(native_launcher.replace('\n', '\r\n').encode('ascii'))
        audio_target = app / 'resources/audio'
        for relative in [*audio_manifest['files'], 'AUDIO-MANIFEST.json']:
            target = audio_target / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(audio_runtime / relative, target)
        settings = json.loads((ROOT / 'apps/stage-kiosk-desktop/kiosk.settings.example.json').read_text(encoding='utf-8'))
        for name in ['kiosk.settings.json', 'kiosk.settings.example.json']:
            (app / name).write_text(json.dumps(settings, ensure_ascii=False, indent=2) + '\n', encoding='utf-8-sig')
        (app / 'Edit Settings.cmd').write_bytes(b'@echo off\r\nnotepad.exe "%~dp0kiosk.settings.json"\r\n')
        (app / '管理後台.url').write_bytes(b'[InternetShortcut]\r\nURL=https://webnavior.aikcitri.qzz.io/admin/system/models\r\n')
        guide = (ROOT / 'scripts/windows/portableQuickStart.txt').read_text(encoding='utf-8')
        (app / '先看我.txt').write_text(guide.replace('\n', '\r\n'), encoding='utf-8-sig', newline='')
        # The whitelist above deliberately excludes source trees, environment files, keys and profiles.
        manifest = {'version': app_version, 'createdAt': datetime.now().astimezone().isoformat(), 'gitCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(), 'electron': VERSION, 'embeddedNode': '24.22.1', 'architecture': 'win32-x64', 'runtimeArchiveSha256': RUNTIME_SHA256, 'audioProvider': 'OpenVINO', 'audioDevice': 'GPU.0', 'signed': False, 'windowsPhysicalValidation': False, 'files': {str(path.relative_to(app)): digest(path) for path in sorted(app.rglob('*')) if path.is_file()}}
        (app / 'PACKAGE-MANIFEST.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
        with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=5) as target:
            for path in sorted(app.rglob('*')):
                if path.is_file():
                    target.write(path, str(Path('Webnavior Kiosk') / path.relative_to(app)))
    checksum = digest(archive)
    archive.with_suffix('.zip.sha256').write_text(f'{checksum}  {archive.name}\n', encoding='ascii')
    with zipfile.ZipFile(archive) as packaged:
        if packaged.testzip() is not None:
            raise ValueError('Generated ZIP failed its CRC check.')
        for name, expected in manifest['files'].items():
            if hashlib.sha256(packaged.read(f'Webnavior Kiosk/{name}')).hexdigest() != expected:
                raise ValueError(f'Packaged file hash mismatch: {name}')
    print(json.dumps({'archive': str(archive.resolve()), 'sha256': checksum, 'bytes': archive.stat().st_size, 'files': len(manifest['files'])}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime-zip', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, default=Path('/tmp'))
    parser.add_argument('--audio-runtime-dir', type=Path, required=True)
    parser.add_argument('--reference', type=Path, required=True, help='Independent ONNX spectral qualification fixture')
    arguments = parser.parse_args()
    package(arguments.runtime_zip, arguments.output_dir, arguments.audio_runtime_dir, arguments.reference)
