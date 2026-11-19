"""Run with python -m unittest discover -s scripts/windows -p 'test*.py'."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('prepareAudio', Path(__file__).with_name('prepareAudio.py'))
prepareAudio = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepareAudio)


class ArchiveTests(unittest.TestCase):
    def test_traversal_cannot_escape_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / 'bad.whl'
            with zipfile.ZipFile(archive, 'w') as source:
                source.writestr('../escaped', 'no')
            with self.assertRaises(ValueError):
                prepareAudio.extract(archive, root / 'output', wheel=True)
            self.assertFalse((root / 'escaped').exists())

    def test_wheel_install_schemes_and_collision(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / 'good.whl'
            site = root / 'python/Lib/site-packages'
            with zipfile.ZipFile(archive, 'w') as source:
                source.writestr('demo/module.py', 'value=1')
                source.writestr('demo.data/data/share/license.txt', 'license')
            prepareAudio.extract(archive, site, wheel=True)
            self.assertTrue((site / 'demo/module.py').is_file())
            self.assertTrue((root / 'python/share/license.txt').is_file())
            with self.assertRaises(ValueError):
                prepareAudio.extract(archive, site, wheel=True)

    def test_corrupt_download_stops_before_creating_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / 'python.zip'
            archive.write_bytes(b'not the pinned Python archive')
            with self.assertRaisesRegex(ValueError, 'SHA256'):
                prepareAudio.prepare(archive, root, root / 'output', root / 'vc.exe', 'unused')
            self.assertFalse((root / 'output').exists())


if __name__ == '__main__':
    unittest.main()
