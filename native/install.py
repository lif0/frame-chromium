#!/usr/bin/env python3
"""Register Frame for Chrome and Chromium in the current user's account."""
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import sys

HOST = 'com.frame.downloader'
SOURCE = Path(__file__).resolve().parent


def destinations(platform, home):
    if platform == 'darwin':
        base = home / 'Library/Application Support'
        return base / 'Frame', [base / browser / 'NativeMessagingHosts' for browser in ('Google/Chrome', 'Chromium')]
    if platform == 'win32':
        return Path(os.environ.get('LOCALAPPDATA', home / 'AppData/Local')) / 'Frame', []
    if platform.startswith('linux'):
        data = Path(os.environ.get('XDG_DATA_HOME', home / '.local/share'))
        config = Path(os.environ.get('XDG_CONFIG_HOME', home / '.config'))
        return data / 'frame', [config / browser / 'NativeMessagingHosts' for browser in ('google-chrome', 'chromium')]
    raise ValueError('Supported systems: macOS, Linux and Windows.')


def install(extension_ids, home=None, platform=None):
    platform = platform or sys.platform
    home = home or Path.home()
    if not extension_ids or any(not re.fullmatch(r'[a-p]{32}', value) for value in extension_ids):
        raise ValueError('Pass the extension ID shown on the Frame setup page (32 letters a–p).')
    extras = [str(home / '.local/bin'), str(home / '.deno/bin'), '/opt/homebrew/bin', '/usr/local/bin']
    search_path = os.pathsep.join([os.environ.get('PATH', ''), *extras])
    programs = {name: shutil.which(name, path=search_path) for name in ('yt-dlp', 'ffmpeg', 'deno')}
    missing = [name for name, path in programs.items() if not path]
    if missing:
        raise ValueError('Missing dependencies: ' + ', '.join(missing) + '. Follow the instructions for your OS, then reopen the terminal.')
    folder, manifest_dirs = destinations(platform, home)
    folder.mkdir(parents=True, exist_ok=True)
    if platform != 'win32':
        folder.chmod(0o700)
    shutil.copy2(SOURCE / 'frame_host.py', folder / 'frame_host.py')
    python = str(Path(sys.executable).absolute())
    if platform == 'win32':
        launcher = folder / 'frame-helper.bat'
        launcher.write_text('@echo off\nsetlocal DisableDelayedExpansion\nchcp 65001 >nul\n"' + python.replace('%', '%%') + '" "%~dp0frame_host.py" %*\n', encoding='utf-8')
    else:
        launcher = folder / 'frame-helper'
        launcher.write_text('#!/bin/sh\nexec ' + shlex.quote(python) + ' ' + shlex.quote(str(folder / 'frame_host.py')) + ' "$@"\n')
        launcher.chmod(0o700)
    config_file = folder / 'config.json'
    config = json.loads(config_file.read_text(encoding='utf-8')) if config_file.exists() else {}
    origins = sorted(set(config.get('allowedOrigins', [])) | {'chrome-extension://' + value + '/' for value in extension_ids})
    config.update(allowedOrigins=origins, programs=programs)
    config.setdefault('downloadDir', str(home / 'Downloads'))
    config_file.write_text(json.dumps(config, indent=2), encoding='utf-8')
    if platform != 'win32':
        config_file.chmod(0o600)
    manifest = {'name': HOST, 'description': 'Frame YouTube downloader', 'path': str(launcher), 'type': 'stdio', 'allowed_origins': origins}
    if platform == 'win32':
        import winreg
        path = folder / (HOST + '.json')
        path.write_text(json.dumps(manifest, indent=2), encoding='utf-8')
        for browser in ('Google\\Chrome', 'Chromium'):
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, 'Software\\' + browser + '\\NativeMessagingHosts\\' + HOST) as key:
                winreg.SetValueEx(key, '', 0, winreg.REG_SZ, str(path))
    else:
        for directory in manifest_dirs:
            directory.mkdir(parents=True, exist_ok=True)
            path = directory / (HOST + '.json')
            path.write_text(json.dumps(manifest, indent=2), encoding='utf-8')
            path.chmod(0o600)
    return folder


if __name__ == '__main__':
    try:
        installed = install(sys.argv[1:])
        print('Frame helper installed in ' + str(installed) + '. Return to Frame and check the connection.')
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
