#!/usr/bin/env python3
"""Own the local PB test system without loading production environment files.

Docker Compose owns persistent test data. This manager owns only its marked
API, Nginx and Electron process groups; stopping never removes volumes or login.
"""

import argparse
import base64
import fcntl
import hashlib
import json
import os
import secrets
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / 'pb-test.local'
ORIGIN = 'http://127.0.0.1:15169'
SHARED_ORIGIN = 'https://webnavior.aikcitri.qzz.io'
ELECTRON_UNITS = {
    'electron': 'webnavior-pb-test-electron.service',
    'shared-electron': 'webnavior-pb-shared-electron.service',
}
PROJECT = 'webnavior-pb-test'


def validate_environment(env, state):
    """Fail closed before any process that can migrate or write is started."""
    db, redis = urlsplit(env['DATABASE_URL']), urlsplit(env['REDIS_URL'])
    if (db.hostname, db.port, db.path, db.username) != ('127.0.0.1', 15434, '/webnavior_pb_test', 'pb_test'):
        raise RuntimeError('拒絕啟動：資料庫不是 PB 專用測試資料庫。')
    if (redis.hostname, redis.port, redis.path) != ('127.0.0.1', 16379, '/0'):
        raise RuntimeError('拒絕啟動：Redis 不是 PB 專用測試服務。')
    expected = {
        'HOST': '127.0.0.1', 'PORT': '15168', 'NODE_ENV': 'development',
        'API_SERVER_URL': ORIGIN, 'WEB_APP_URL': ORIGIN,
        'KIOSK_POS_BRIDGE_URL': 'http://127.0.0.1:15170/',
        'WEBNAVIOR_KIOSK_ASSET_DIR': str(state / 'assets'),
        'KIOSK_ADMIN_PIN_FILE': str(state / 'admin.pin'),
    }
    if any(env.get(key) != value for key, value in expected.items()):
        raise RuntimeError('拒絕啟動：測試路徑或連接位置遭到修改。')
    if state.is_symlink() or state.resolve() != state.absolute():
        raise RuntimeError('測試資料目錄不可連結到其他位置。')
    for directory in ('assets', 'site', 'desktop-profile', 'shared-desktop-profile'):
        if (state / directory).is_symlink():
            raise RuntimeError('測試資料目錄不可使用符號連結。')


def process_identity(pid):
    """Linux starttime distinguishes a saved process from a reused PID."""
    try:
        text = Path(f'/proc/{pid}/stat').read_text()
        fields = text[text.rindex(')') + 2:].split()
        if fields[0] == 'Z':
            return None
        return fields[19]
    except (OSError, ValueError, IndexError):
        return None


class System:
    def __init__(self, state=STATE):
        self.state = state
        self.log = state / 'logs'

    def setup(self):
        if self.state.is_symlink():
            raise RuntimeError('測試資料目錄不可是符號連結。')
        self.state.mkdir(mode=0o700, exist_ok=True)
        self.state.chmod(0o700)
        for name in ('logs', 'assets', 'site', 'desktop-profile', 'shared-desktop-profile'):
            (self.state / name).mkdir(mode=0o700, exist_ok=True)
        config = self.state / 'server.json'
        if not config.exists():
            env = {
                'HOST': '127.0.0.1', 'PORT': '15168', 'NODE_ENV': 'development',
                'API_SERVER_URL': ORIGIN, 'WEB_APP_URL': ORIGIN,
                'AUTH_UI_URL': ORIGIN, 'ADMIN_UI_URL': ORIGIN,
                'ADDITIONAL_TRUSTED_ORIGINS': ORIGIN,
                'DATABASE_URL': f'postgresql://pb_test:{secrets.token_hex(24)}@127.0.0.1:15434/webnavior_pb_test',
                'REDIS_URL': 'redis://127.0.0.1:16379/0',
                'BETTER_AUTH_SECRET': secrets.token_hex(32),
                'LLM_ROUTER_MASTER_KEY': base64.b64encode(secrets.token_bytes(32)).decode(),
                'WEBNAVIOR_KIOSK_ASSET_DIR': str(self.state / 'assets'),
                'KIOSK_ADMIN_PIN_FILE': str(self.state / 'admin.pin'),
                'KIOSK_DEVELOPMENT_REGISTRATION_ENABLED': 'true',
                'WEBNAVIOR_TEST_AUTH_ENABLED': 'true',
                'KIOSK_POS_BRIDGE_URL': 'http://127.0.0.1:15170/',
                'AUTH_GOOGLE_CLIENT_ID': 'pb-test-disabled', 'AUTH_GOOGLE_CLIENT_SECRET': 'pb-test-disabled',
                'AUTH_GITHUB_CLIENT_ID': 'pb-test-disabled', 'AUTH_GITHUB_CLIENT_SECRET': 'pb-test-disabled',
                'ADMIN_EMAILS': 'admin@webnavior.local',
            }
            self.write_private(config, json.dumps(env, indent=2))
            self.write_private(self.state / 'admin.pin', '0000')
        env = self.environment()
        self.write_private(self.state / 'compose.env', 'PB_TEST_DATABASE_PASSWORD=' + urlsplit(env['DATABASE_URL']).password + '\n')

    @staticmethod
    def write_private(path, content):
        with open(path, 'w', opener=lambda name, flags: os.open(name, flags, 0o600)) as stream:
            stream.write(content)
        path.chmod(0o600)

    def environment(self):
        # No .env.local, dotenv overload, inherited provider key or telemetry config.
        env = json.loads((self.state / 'server.json').read_text())
        validate_environment(env, self.state)
        base = {key: value for key, value in os.environ.items() if key in (
            'PATH', 'HOME', 'USER', 'LANG', 'DISPLAY', 'WAYLAND_DISPLAY',
            'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'XAUTHORITY',
        )}
        return {**base, **env, 'PB_TEST_INSTANCE': str(self.state)}

    def compose(self, *args):
        return ['docker', 'compose', '--project-name', PROJECT,
                '--env-file', str(self.state / 'compose.env'),
                '-f', str(ROOT / 'scripts/pbTest/compose.yaml'), *args]

    def run(self, args, name, cwd=ROOT, env=None):
        with (self.log / f'{name}.log').open('ab') as output:
            result = subprocess.run(args, cwd=cwd, env=env or self.environment(), stdout=output, stderr=subprocess.STDOUT)
        if result.returncode:
            raise RuntimeError(f'{name} 未完成；請在管理介面選擇「查看記錄」。')

    def record(self, name):
        try:
            record = json.loads((self.state / f'{name}.pid.json').read_text())
            pid = record['pid']
            if process_identity(pid) != record['start']:
                return None
            if name == 'web' or name in ELECTRON_UNITS:
                # Nginx and Chromium rewrite the initial environment block.
                # Starttime plus binary and the unique config/entry identify
                # our process even after its environment marker is erased.
                command = Path(f'/proc/{pid}/cmdline').read_bytes()
                binary = os.readlink(f'/proc/{pid}/exe')
                if name == 'web' and binary == '/usr/sbin/nginx' and str(self.state / 'nginx.conf').encode() in command:
                    return record
                entry = str(ROOT / 'apps/stage-kiosk-desktop/out/main/index.js').encode()
                # Chromium also joins argv into a single process title after
                # startup. Match our complete invocation, not an arbitrary
                # substring, or a live window gets mistaken for a failed one.
                title = str(self.state / 'runtime/electron').encode() + b' ' + entry
                owns_entry = entry in command.split(b'\0') or command.rstrip(b'\0') == title
                if name in ELECTRON_UNITS and record.get('unit') == ELECTRON_UNITS[name] and binary == str(self.state / 'runtime/electron') and owns_entry:
                    return record
                return None
            marker = f'PB_TEST_INSTANCE={self.state}'.encode()
            if marker in Path(f'/proc/{pid}/environ').read_bytes().split(b'\0'):
                return record
        except (OSError, KeyError, ValueError):
            pass
        return None

    def spawn(self, name, args, cwd=ROOT, env=None):
        if self.record(name):
            return
        with (self.log / f'{name}.log').open('ab') as output:
            proc = subprocess.Popen(args, cwd=cwd, env=env or self.environment(), stdout=output,
                                    stderr=subprocess.STDOUT, start_new_session=True)
        self.write_private(self.state / f'{name}.pid.json', json.dumps({'pid': proc.pid, 'start': process_identity(proc.pid)}))

    def stop_process(self, name):
        record = self.record(name)
        if not record:
            return
        if name in ELECTRON_UNITS and record.get('unit') == ELECTRON_UNITS[name]:
            self.run(['systemctl', '--user', 'stop', record['unit']], name + '-stop')
            (self.state / f'{name}.pid.json').unlink(missing_ok=True)
            return
        pid = record['pid']
        os.killpg(pid, signal.SIGTERM)
        for _ in range(50):
            if not self.record(name):
                break
            time.sleep(0.1)
        if self.record(name):
            os.killpg(pid, signal.SIGKILL)
        (self.state / f'{name}.pid.json').unlink(missing_ok=True)

    @staticmethod
    def ready(url):
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                body = json.load(response)
                return (response.status == 200 and isinstance(body, dict)
                        and body.get('status') == 'ready'
                        and body.get('checks') == {'db': 'ok', 'redis': 'ok'})
        except (OSError, urllib.error.URLError, ValueError):
            return False

    def build(self):
        if any(self.record(name) for name in ('api', 'web', 'electron', 'shared-electron')):
            raise RuntimeError('請先關閉共用與本機 Electron，並停止本機測試系統再更新，避免混用版本。')
        env = self.environment()
        env.update({
            'VITE_SERVER_URL': ORIGIN, 'VITE_API_SERVER_URL': ORIGIN,
            'VITE_AIRI_CLOUD_ENABLED': 'false',
            'VITE_ORDERING_SCENARIO_URL': 'https://app.esgpb.com/order/store/1kgJeql/internal_use/menu/select-table',
            'VITE_ORDER_MENU_URL': 'http://127.0.0.1:15170/',
        })
        self.run(['pnpm', '-F', '@proj-airi/server-schema', 'build'], 'build-schema', env=env)
        for package, directory, base in [('stage-kiosk', 'kiosk', '/kiosk/'), ('stage-web', 'web', '/')]:
            self.run(['pnpm', '-F', f'@proj-airi/{package}', 'exec', 'vite', 'build', '--mode', 'pb-test',
                      '--base', base, '--outDir', str(self.state / 'site' / directory)], f'build-{package}', env=env)
        self.run(['pnpm', '-F', '@proj-airi/stage-kiosk-desktop', 'build'], 'build-desktop', env=env)
        self.write_private(self.state / 'built.json', json.dumps({'builtAt': time.strftime('%Y-%m-%d %H:%M:%S')}))

    def nginx_config(self):
        # Separate non-root master and prefix: never reload the system Nginx.
        prefix = self.state
        config = rf'''pid "{prefix}/nginx.pid";
error_log "{self.log}/nginx-error.log";
events {{ worker_connections 128; }}
http {{
 include /etc/nginx/mime.types;
 access_log off;
 client_body_temp_path "{prefix}/nginx-body";
 proxy_temp_path "{prefix}/nginx-proxy";
 server {{
  listen 127.0.0.1:15169;
  server_name 127.0.0.1;
  root "{prefix}/site/web";
  client_max_body_size 128m;
  location = / {{ return 302 /admin; }}
  location = /kiosk {{ return 302 /kiosk/; }}
  location ~ ^/(api/|assets/kiosk/|auth/sign-in$|\.well-known/|ws/chat|livez$|readyz$) {{
   proxy_pass http://127.0.0.1:15168;
   proxy_http_version 1.1;
   proxy_set_header Host $http_host;
   proxy_set_header X-Forwarded-Proto $scheme;
   proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection "upgrade";
   proxy_read_timeout 180s;
  }}
  # Hashed assets are versioned; the entry must revalidate across Electron restarts.
  location = /kiosk/index.html {{ root "{prefix}/site"; add_header Cache-Control "no-cache" always; }}
  location /kiosk/ {{ root "{prefix}/site"; try_files $uri $uri/ /kiosk/index.html; }}
  location /assets/ {{ try_files $uri =404; }}
  location / {{ try_files $uri $uri/ /index.html; }}
 }}
}}
'''
        self.write_private(prefix / 'nginx.conf', config)

    def start(self):
        self.setup()
        if not (self.state / 'built.json').exists():
            raise RuntimeError('請先選擇「更新測試程式」，完成首次建置。')
        self.run(self.compose('up', '-d', '--wait', '--wait-timeout', '90'), 'containers')
        try:
            if not self.record('api'):
                self.check_free_port(15168)
                self.spawn('api', ['node', '--import', 'tsx', str(ROOT / 'apps/server/src/bin/run.ts'), 'api'], ROOT / 'apps/server')
            for _ in range(60):
                if self.record('api') and self.ready('http://127.0.0.1:15168/readyz'):
                    break
                time.sleep(1)
            else:
                raise RuntimeError('測試後端未就緒，請查看 api.log。')
            self.run(['node', '--import', 'tsx', 'src/scripts/seed-webnavior-test-accounts.ts'], 'seed-accounts', ROOT / 'apps/server')
            self.run(['node', '--import', 'tsx', 'src/scripts/seedPbTest.ts'], 'seed-pb', ROOT / 'apps/server')
            if not self.record('web'):
                self.check_free_port(15169)
                self.nginx_config()
                self.spawn('web', ['/usr/sbin/nginx', '-p', str(self.state) + '/', '-c', str(self.state / 'nginx.conf'), '-g', 'daemon off;'])
            for _ in range(20):
                if self.record('web') and self.ready(ORIGIN + '/readyz'):
                    print('PB 測試系統已啟動。')
                    return
                time.sleep(0.5)
            raise RuntimeError('測試頁面未就緒，請查看 web.log。')
        except Exception:
            # Stop only this manager's processes; persistent volumes are retained.
            self.stop_process('web')
            self.stop_process('api')
            raise

    @staticmethod
    def check_free_port(port):
        with socket.socket() as probe:
            # API/Nginx reuse listening addresses. Prior HTTP connections can
            # remain in TIME_WAIT after a clean stop and are not live owners.
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(('127.0.0.1', port))
            except OSError as error:
                raise RuntimeError(f'測試連接埠 {port} 已被占用，未接管該服務。') from error

    def stop(self):
        # Close the native client before its backend; data/login remain on disk.
        for name in ('electron', 'web', 'api'):
            self.stop_process(name)
        self.run(self.compose('stop'), 'containers-stop')
        print('PB 測試系統已停止；測試資料及登入保留。')

    def electron(self):
        if not self.record('web') or not self.ready(ORIGIN + '/readyz'):
            raise RuntimeError('請先啟動 PB 測試系統。')
        self.open_electron('electron', ORIGIN, 'desktop-profile')

    def shared_electron(self):
        # This Ubuntu host owns the public origin's reverse proxy. Probe that
        # API locally; the browser itself still uses HTTPS, as Windows does.
        # No PB database, Redis, or isolated API needs to be started here.
        if not self.ready('http://127.0.0.1:5169/readyz'):
            raise RuntimeError('共用後端尚未就緒，請檢查 webnavior-api；不會改開本機隔離服務。')
        self.open_electron('shared-electron', SHARED_ORIGIN, 'shared-desktop-profile')

    def close_shared_electron(self):
        self.stop_process('shared-electron')

    def open_electron(self, name, origin, profile):
        """Own one client lifecycle without mixing backend credentials or profiles."""
        executable = self.state / 'runtime/electron'
        if not executable.is_file():
            raise RuntimeError('尚未安裝已核對的 Linux Electron 測試執行器。')
        if not self.sandbox_ready():
            raise RuntimeError('第一次使用請先選擇「完成 Ubuntu 啟動設定」，在系統視窗完成管理員驗證。')
        if self.record(name):
            return
        # Launch through the desktop user's manager, not the development tool's
        # inherited process confinement. Direct launches could not access the
        # Chromium profile even after AppArmor setup; the user service can.
        unit = ELECTRON_UNITS[name]
        self.run([
            'systemd-run', '--user', '--unit=' + unit, '--collect', '--property=Type=exec',
            '--property=StandardOutput=append:' + str(self.log / f'{name}.log'),
            '--property=StandardError=append:' + str(self.log / f'{name}.log'),
            '--setenv=KIOSK_DESKTOP_URL=' + origin + '/kiosk/',
            '--setenv=KIOSK_DESKTOP_WINDOWED=1',
            '--setenv=KIOSK_DESKTOP_USER_DATA=' + str(self.state / profile),
            str(executable), str(ROOT / 'apps/stage-kiosk-desktop/out/main/index.js'),
        ], name + '-launch')
        query = subprocess.run(['systemctl', '--user', 'show', unit, '--property=MainPID', '--value'],
                               env=self.environment(), capture_output=True, text=True)
        if query.returncode or not query.stdout.strip().isdigit() or int(query.stdout.strip()) <= 0:
            raise RuntimeError('Electron 使用者服務未啟動，請查看 electron.log。')
        pid = int(query.stdout.strip())
        self.write_private(self.state / f'{name}.pid.json', json.dumps({'pid': pid, 'start': process_identity(pid), 'unit': unit}))
        time.sleep(2)
        if not self.record(name):
            raise RuntimeError('Electron 未啟動，請查看 electron.log。')

    def sandbox_ready(self):
        """A matching root profile plus successful installation stamp, not a bypass."""
        try:
            profile = Path('/etc/apparmor.d/webnavior-pb-test').read_bytes()
            stamp = (self.state / 'sandbox-ready').read_text().split()[0]
            attachment = f'profile webnavior-pb-test "{self.state}/runtime/electron"'.encode()
            return attachment in profile and hashlib.sha256(profile).hexdigest() == stamp
        except (OSError, IndexError):
            return False

    def status(self):
        print('跨機器共用入口：' + SHARED_ORIGIN + '/kiosk/')
        print('共用後端：' + ('就緒' if self.ready('http://127.0.0.1:5169/readyz') else '尚未就緒'))
        print('共用 Electron：' + ('已開啟' if self.record('shared-electron') else '尚未開啟'))
        running = bool(self.record('api') and self.record('web') and self.ready(ORIGIN + '/readyz'))
        print('本機隔離系統：' + ('運作中' if running else '尚未就緒／已停止'))
        print('本機隔離後台：' + ORIGIN + '/admin')
        print('管理帳號：admin@webnavior.local（測試模式，免密碼）')
        print('首次設備登記：在 Electron 選擇「建立測試設備」。')
        print('本機隔離 Electron：' + ('已開啟' if self.record('electron') else '尚未開啟'))
        print('Ubuntu 啟動設定：' + ('已完成' if self.sandbox_ready() else '需要完成一次系統管理員驗證'))
        print('現場管理 PIN：請選擇「顯示測試 PIN」。')
        print('模型需在測試後台設定；不會自動複製正式模型金鑰。')
        print('停止保留資料，不會清除測試紀錄或 PB 登入。')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('setup', 'build', 'start', 'stop', 'status', 'electron', 'shared-electron', 'close-shared-electron', 'pin'))
    args = parser.parse_args()
    system = System()
    # flock serializes changes across desktop clicks and terminal invocations.
    if STATE.is_symlink():
        raise RuntimeError('測試資料目錄不可是符號連結。')
    STATE.mkdir(mode=0o700, exist_ok=True)
    with (STATE / 'manager.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('另一個管理操作正在執行，請稍候。') from None
        system.setup()
        if args.action == 'pin':
            print((STATE / 'admin.pin').read_text())
        else:
            getattr(system, args.action.replace('-', '_'))()


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
