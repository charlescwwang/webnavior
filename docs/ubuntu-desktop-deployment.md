# Ubuntu Desktop Deployment

Target: Ubuntu 24.04 x86_64.

## Build

```bash
git clone https://github.com/charlescwwang/webnavior.git
cd webnavior
bash scripts/buildUbuntuDeb.sh --setup
```

Later builds do not need `--setup`:

```bash
git pull
bash scripts/buildUbuntuDeb.sh
```

## Install

```bash
bash scripts/installUbuntuAmd.sh apps/stage-tamagotchi/dist/AIRI-*-linux-x64.deb
```

## Run

```bash
airi
```

If the graphical session uses Wayland and AIRI does not render correctly:

```bash
airi --ozone-platform=x11
```
