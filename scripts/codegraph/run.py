#!/usr/bin/env python3
"""Run the pinned native CLI with a shared resource budget and read-only source.

Each invocation has its own systemd scope. Detached native daemons stay in the
scope after their first stdio client closes; all scopes share one bounded slice.
CodeGraph owns watching, writer locks, reconnects, and its five-minute idle exit.
The launcher does not relay MCP messages or stop another client's daemon.

Call flow: Codex/CLI -> systemd scope -> Bubblewrap -> native CodeGraph CLI.
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['init', 'index', 'sync', 'status', 'serve', 'stop'])
    parser.add_argument('--path', type=Path, default=Path.cwd(), help='A directory in the target Git worktree')
    args = parser.parse_args()
    checkout = Path(__file__).resolve().parents[2]
    slice_file = Path(__file__).with_name('webnaviorCodegraph.slice')

    if args.command == 'stop':
        # This slice belongs only to this integration. Stop all its worktree
        # clients and daemons together after disabling MCP; never signal app PIDs.
        os.execvp('systemctl', ['systemctl', '--user', 'stop', slice_file.name])

    result = subprocess.run(['git', '-C', str(args.path), 'rev-parse', '--show-toplevel'], check=True, capture_output=True, text=True)
    root = Path(result.stdout.strip()).resolve()
    if not (root / 'codegraph.json').is_file():
        raise RuntimeError('The target worktree needs its own codegraph.json before indexing.')
    bundle = checkout / 'codegraph-pilot.local/tool-v1.6.3/codegraph-linux-x64'
    package = json.loads((bundle / 'lib/package.json').read_text())
    if package['version'] != '1.6.3':
        raise RuntimeError('Expected the verified CodeGraph 1.6.3 bundle.')

    os.umask(0o077)
    index = root / '.codegraph'
    index.mkdir(exist_ok=True)
    # The short, shared host path also lets native Unix sockets work when a
    # worktree path is too long. CodeGraph isolates socket names by project hash.
    runtime = Path('/tmp') / ('webnavior-codegraph-' + str(os.getuid()))
    runtime.mkdir(mode=0o700, exist_ok=True)
    if runtime.is_symlink() or runtime.stat().st_uid != os.getuid():
        raise RuntimeError('The CodeGraph temporary directory must belong to this user.')
    runtime.chmod(0o700)
    for directory in ['cache', 'config']:
        (index / directory).mkdir(exist_ok=True)

    # Runtime linking installs no boot service and is idempotent across clients.
    # The slice caps aggregate use, including detached daemons from older scopes.
    subprocess.run(['systemctl', '--user', 'link', '--runtime', '--quiet', str(slice_file)], check=True, stdout=sys.stderr)
    native = [str(bundle / 'bin/codegraph'), args.command]
    if args.command == 'serve':
        native += ['--mcp', '--path', str(root), '--no-telemetry']
    else:
        native += [str(root)]
        if args.command == 'init':
            native += ['--local-only', '--yes']

    # Do not forward model keys or inherited watcher/daemon overrides to the
    # subprocess. Its only writable mounts are its index and temporary directory.
    environment = {
        'PATH': '/usr/local/bin:/usr/bin:/bin',
        'HOME': str(Path.home()),
        'LANG': 'C.UTF-8',
        'TMPDIR': str(runtime),
        'XDG_CACHE_HOME': str(index / 'cache'),
        'XDG_CONFIG_HOME': str(index / 'config'),
        'CODEGRAPH_TELEMETRY': '0',
        'DO_NOT_TRACK': '1',
        'CODEGRAPH_NO_UPDATE_CHECK': '1',
        'CODEGRAPH_MCP_TOOLS': 'explore,status,search,node,callers,files',
        'NODE_OPTIONS': '--max-old-space-size=1024',
        'RAYON_NUM_THREADS': '2',
        'UV_THREADPOOL_SIZE': '2',
    }
    command = [
        'systemd-run', '--user', '--scope', '--quiet', '--collect',
        '--slice=' + slice_file.name, '--expand-environment=no',
        'nice', '-n', '19', 'ionice', '-c', '3',
        # A private /dev supplies /dev/null for detached native children. A
        # read-only root bind alone marks host device nodes nodev (spawn EACCES).
        'bwrap', '--ro-bind', '/', '/', '--dev', '/dev', '--bind', str(index), str(index),
        '--bind', str(runtime), str(runtime), '--unshare-net',
        '--chdir', str(root), '--clearenv',
    ]
    for key, value in environment.items():
        command += ['--setenv', key, value]
    command += ['--', *native]
    # exec preserves stdio framing and lets systemd-run return the CLI exit code.
    os.execvp(command[0], command)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print('CodeGraph launcher: ' + str(error), file=sys.stderr)
        sys.exit(1)
