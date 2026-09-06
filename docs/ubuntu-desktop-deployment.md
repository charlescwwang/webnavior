# Ubuntu Desktop Deployment

Target: Ubuntu 24.04 x86_64.

## One-time build machine setup

```bash
sudo apt update
sudo apt install -y build-essential curl git pkg-config unzip
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
corepack enable
corepack prepare pnpm@10.33.0 --activate
```

```bash
curl -fLO https://packages.microsoft.com/config/ubuntu/24.04/packages-microsoft-prod.deb
sudo dpkg -i packages-microsoft-prod.deb
rm packages-microsoft-prod.deb
sudo apt update
sudo apt install -y dotnet-sdk-8.0
```

```bash
mkdir -p ~/.local/opt/godot ~/.local/bin
curl -fL -o /tmp/godot.zip https://github.com/godotengine/godot/releases/download/4.6.2-stable/Godot_v4.6.2-stable_mono_linux_x86_64.zip
unzip -o /tmp/godot.zip -d ~/.local/opt/godot
rm /tmp/godot.zip
ln -sf ~/.local/opt/godot/Godot_v4.6.2-stable_mono_linux_x86_64 ~/.local/bin/godot
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
godot --version
```

## Build

```bash
git clone https://github.com/charlescwwang/webnavior.git
cd webnavior
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
