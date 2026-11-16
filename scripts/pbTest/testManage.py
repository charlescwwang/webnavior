"""Isolation and persistence checks; no live Docker, database or service IO."""

import importlib.util
import io
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('pb_manage', Path(__file__).with_name('manage.py'))
manager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manager)


class IsolationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = Path(self.temp.name) / 'pb-test.local'
        self.system = manager.System(self.state)
        self.system.setup()
        self.env = self.system.environment()

    def test_default_local_test_pin_is_four_zeroes(self):
        self.assertEqual((self.state / 'admin.pin').read_text(), '0000')

    def test_setup_preserves_secrets_pin_and_existing_data(self):
        config = (self.state / 'server.json').read_bytes()
        pin = (self.state / 'admin.pin').read_bytes()
        media = self.state / 'assets' / 'retained'
        media.write_text('test evidence')
        self.system.setup()
        self.assertEqual((self.state / 'server.json').read_bytes(), config)
        self.assertEqual((self.state / 'admin.pin').read_bytes(), pin)
        self.assertEqual(media.read_text(), 'test evidence')
        self.assertEqual(stat.S_IMODE((self.state / 'server.json').stat().st_mode), 0o600)

    # Report: this chat, Nov12; restarting Electron reused an old cached Kiosk entry.
    def test_kiosk_entry_revalidates_after_a_test_program_update(self):
        self.system.nginx_config()
        config = (self.state / 'nginx.conf').read_text()
        entry = config.split('location = /kiosk/index.html {', 1)[1].split('}', 1)[0]
        self.assertIn('add_header Cache-Control "no-cache" always;', entry)
        self.assertIn(str(self.state / 'site'), entry)

    def test_production_database_and_redis_are_rejected(self):
        for key, value in [('DATABASE_URL', 'postgres://pb_test:x@127.0.0.1:5434/webnavior'),
                           ('REDIS_URL', 'redis://127.0.0.1:6379/0')]:
            with self.subTest(key=key):
                with self.assertRaises(RuntimeError):
                    manager.validate_environment({**self.env, key: value}, self.state)

    def test_wrong_database_name_and_remote_host_are_rejected(self):
        for url in ['postgres://pb_test:x@127.0.0.1:15434/webnavior',
                    'postgres://pb_test:x@other:15434/webnavior_pb_test']:
            with self.assertRaises(RuntimeError):
                manager.validate_environment({**self.env, 'DATABASE_URL': url}, self.state)

    def test_production_asset_pin_and_bridge_paths_are_rejected(self):
        for key, value in [('WEBNAVIOR_KIOSK_ASSET_DIR', '/var/lib/webnavior/kiosk-assets'),
                           ('KIOSK_ADMIN_PIN_FILE', '/etc/webnavior/admin.pin'),
                           ('KIOSK_POS_BRIDGE_URL', 'http://127.0.0.1:5170/')]:
            with self.subTest(key=key):
                with self.assertRaises(RuntimeError):
                    manager.validate_environment({**self.env, key: value}, self.state)

    def test_inherited_environment_secrets_are_not_forwarded(self):
        with patch.dict(os.environ, {'DATABASE_URL': 'production', 'STRIPE_SECRET_KEY': 'production',
                                    'AUTH_GOOGLE_CLIENT_SECRET': 'production'}):
            env = self.system.environment()
        self.assertNotIn('STRIPE_SECRET_KEY', env)
        self.assertNotEqual(env['DATABASE_URL'], 'production')
        self.assertNotEqual(env['AUTH_GOOGLE_CLIENT_SECRET'], 'production')

    def test_symlink_to_external_data_is_rejected(self):
        (self.state / 'assets').rmdir()
        (self.state / 'assets').symlink_to(Path(self.temp.name))
        with self.assertRaises(RuntimeError):
            self.system.environment()

    def test_stale_pid_does_not_authorize_signals(self):
        pid = os.getpid()
        (self.state / 'api.pid.json').write_text(json.dumps({'pid': pid, 'start': 'old-process'}))
        with patch.object(os, 'killpg') as kill:
            self.system.stop_process('api')
        kill.assert_not_called()

    def test_build_refuses_to_replace_running_services(self):
        with patch.object(self.system, 'record', return_value={'pid': 123}):
            with self.assertRaises(RuntimeError):
                self.system.build()

    def test_nginx_erased_environment_uses_its_own_config_and_starttime(self):
        record = {'pid': 123, 'start': 'born'}
        (self.state / 'web.pid.json').write_text(json.dumps(record))
        command = b'nginx: master process nginx -c ' + str(self.state / 'nginx.conf').encode()
        with patch.object(manager, 'process_identity', return_value='born'), \
                patch.object(os, 'readlink', return_value='/usr/sbin/nginx'), \
                patch.object(Path, 'read_bytes', return_value=command):
            self.assertEqual(self.system.record('web'), record)
        with patch.object(manager, 'process_identity', return_value='born'), \
                patch.object(os, 'readlink', return_value='/usr/sbin/nginx'), \
                patch.object(Path, 'read_bytes', return_value=b'nginx -c /etc/nginx/nginx.conf'):
            self.assertIsNone(self.system.record('web'))

    def test_electron_erased_environment_requires_the_test_binary_and_entry(self):
        record = {'pid': 123, 'start': 'born', 'unit': 'webnavior-pb-test-electron.service'}
        (self.state / 'electron.pid.json').write_text(json.dumps(record))
        command = str(self.state / 'runtime/electron').encode() + b'\0' + str(manager.ROOT / 'apps/stage-kiosk-desktop/out/main/index.js').encode() + b'\0'
        with patch.object(manager, 'process_identity', return_value='born'), \
                patch.object(os, 'readlink', return_value=str(self.state / 'runtime/electron')), \
                patch.object(Path, 'read_bytes', return_value=command):
            self.assertEqual(self.system.record('electron'), record)
        with patch.object(manager, 'process_identity', return_value='born'), \
                patch.object(os, 'readlink', return_value='/another/electron'), \
                patch.object(Path, 'read_bytes', return_value=command):
            self.assertIsNone(self.system.record('electron'))

    def test_electron_rewritten_process_title_still_identifies_the_live_window(self):
        record = {'pid': 123, 'start': 'born', 'unit': 'webnavior-pb-test-electron.service'}
        (self.state / 'electron.pid.json').write_text(json.dumps(record))
        binary = str(self.state / 'runtime/electron')
        title = (binary + ' ' + str(manager.ROOT / 'apps/stage-kiosk-desktop/out/main/index.js')).encode() + b'\0'
        with patch.object(manager, 'process_identity', return_value='born'), \
                patch.object(os, 'readlink', return_value=binary), \
                patch.object(Path, 'read_bytes', return_value=title):
            self.assertEqual(self.system.record('electron'), record)

    def test_electron_uses_user_service_without_sandbox_bypass_or_server_secrets(self):
        (self.state / 'runtime').mkdir()
        (self.state / 'runtime/electron').write_text('test binary boundary')
        query = subprocess.CompletedProcess([], 0, stdout='321\n', stderr='')
        with patch.object(self.system, 'ready', return_value=True), \
                patch.object(self.system, 'sandbox_ready', return_value=True), \
                patch.object(self.system, 'record', side_effect=[{'pid': 1}, None, {'pid': 321}]), \
                patch.object(self.system, 'run') as launch, \
                patch.object(subprocess, 'run', return_value=query), \
                patch.object(manager, 'process_identity', return_value='born'), \
                patch.object(manager.time, 'sleep'):
            self.system.electron()
        command = launch.call_args.args[0]
        self.assertEqual(command[:2], ['systemd-run', '--user'])
        self.assertIn('--setenv=KIOSK_DESKTOP_USER_DATA=' + str(self.state / 'desktop-profile'), command)
        self.assertNotIn('--no-sandbox', command)
        self.assertFalse(any('DATABASE_URL' in arg for arg in command))
        self.assertEqual(json.loads((self.state / 'electron.pid.json').read_text())['unit'], 'webnavior-pb-test-electron.service')

    def test_stop_uses_only_the_verified_electron_unit(self):
        record = {'pid': 321, 'start': 'born', 'unit': 'webnavior-pb-test-electron.service'}
        with patch.object(self.system, 'record', return_value=record), \
                patch.object(self.system, 'run') as stop, \
                patch.object(os, 'killpg') as kill:
            self.system.stop_process('electron')
        stop.assert_called_once_with(['systemctl', '--user', 'stop', 'webnavior-pb-test-electron.service'], 'electron-stop')
        kill.assert_not_called()

    # Report: this chat, Nov16 — Ubuntu and Windows must use the same backend.
    def test_shared_electron_does_not_require_the_isolated_backend(self):
        (self.state / 'runtime').mkdir()
        (self.state / 'runtime/electron').write_text('test binary boundary')
        query = subprocess.CompletedProcess([], 0, stdout='321\n', stderr='')
        with patch.object(self.system, 'ready', return_value=True) as ready, \
                patch.object(self.system, 'sandbox_ready', return_value=True), \
                patch.object(self.system, 'record', side_effect=[None, {'pid': 321}]) as record, \
                patch.object(self.system, 'run') as launch, \
                patch.object(subprocess, 'run', return_value=query), \
                patch.object(manager, 'process_identity', return_value='born'), \
                patch.object(manager.time, 'sleep'):
            self.system.shared_electron()
        ready.assert_called_once_with('http://127.0.0.1:5169/readyz')
        self.assertNotIn(('web',), [call.args for call in record.call_args_list])
        command = launch.call_args.args[0]
        self.assertIn('--setenv=KIOSK_DESKTOP_URL=https://webnavior.aikcitri.qzz.io/kiosk/', command)
        self.assertIn('--setenv=KIOSK_DESKTOP_USER_DATA=' + str(self.state / 'shared-desktop-profile'), command)
        self.assertNotIn('--no-sandbox', command)
        self.assertEqual(json.loads((self.state / 'shared-electron.pid.json').read_text())['unit'], 'webnavior-pb-shared-electron.service')

    def test_closing_shared_electron_does_not_stop_backend_or_local_window(self):
        record = {'pid': 321, 'start': 'born', 'unit': 'webnavior-pb-shared-electron.service'}
        with patch.object(self.system, 'record', return_value=record), \
                patch.object(self.system, 'run') as stop, \
                patch.object(os, 'killpg') as kill:
            self.system.close_shared_electron()
        stop.assert_called_once_with(['systemctl', '--user', 'stop', 'webnavior-pb-shared-electron.service'], 'shared-electron-stop')
        kill.assert_not_called()

    def test_swapping_shared_and_isolated_pid_records_is_rejected(self):
        record = {'pid': 123, 'start': 'born', 'unit': 'webnavior-pb-test-electron.service'}
        (self.state / 'shared-electron.pid.json').write_text(json.dumps(record))
        binary = str(self.state / 'runtime/electron')
        entry = str(manager.ROOT / 'apps/stage-kiosk-desktop/out/main/index.js')
        with patch.object(manager, 'process_identity', return_value='born'), \
                patch.object(os, 'readlink', return_value=binary), \
                patch.object(Path, 'read_bytes', return_value=(binary + ' ' + entry).encode()):
            self.assertIsNone(self.system.record('shared-electron'))

    def test_health_check_rejects_spa_html_with_http_200(self):
        class Response(io.BytesIO):
            status = 200
        with patch.object(manager.urllib.request, 'urlopen', return_value=Response(b'<html>SPA</html>')):
            self.assertFalse(self.system.ready('http://127.0.0.1:5169/readyz'))
        with patch.object(manager.urllib.request, 'urlopen', return_value=Response(b'{"status":"ready","checks":{"db":"ok","redis":"ok"}}')):
            self.assertTrue(self.system.ready('http://127.0.0.1:5169/readyz'))


if __name__ == '__main__':
    unittest.main()
