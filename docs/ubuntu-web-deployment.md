# Ubuntu Web deployment

This deploys browser-based Stage Web, Stage Kiosk, and the order-menu page. It
does not install or use Electron, Godot, Redis, Postgres, or an AIRI API server.

For the complete WebNavior kiosk deployment, including the Server API, an
existing PostgreSQL service, Docker Redis, systemd, and a safe update process,
use [Ubuntu WebNavior Kiosk Server 部署](ubuntu-webnavior-kiosk-server-deployment.md).

## First deployment

On the Ubuntu machine, clone the repository and run the following. Replace the
origin with the exact address the browser will use to access this machine.

```bash
git clone https://github.com/charlescwwang/webnavior.git
cd webnavior
bash scripts/deployWebUbuntu.sh --setup --origin http://192.168.1.10
```

The setup installs Nginx and build prerequisites. Node.js `24.13.0` is installed
under `~/.local/opt/airi-web-node`, so it does not replace Ubuntu's system Node.js.

Open:

```text
http://192.168.1.10/        Stage Web
http://192.168.1.10/kiosk/  Stage Kiosk
http://192.168.1.10/menu/   Order menu
```

## Update

```bash
cd ~/webnavior
git pull --ff-only
bash scripts/deployWebUbuntu.sh --origin http://192.168.1.10
```

Use your real HTTPS origin in both commands once a domain and TLS certificate are
configured. A kiosk accessed from another device needs HTTPS for browser
microphone and camera permissions.

## Scope reserved for later

The Nginx origin is intentionally kept stable. A future AIRI API server can be
added behind `/api/` without changing the Web or kiosk URLs. That later phase
will require `apps/server`, Postgres, Redis, API credentials, backups, and kiosk
device identity; it is not part of this installation.
