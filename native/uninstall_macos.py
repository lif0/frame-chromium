#!/usr/bin/env python3
"""Remove frame-helper registrations and owned files, preserving videos and Chrome."""
import argparse
from pathlib import Path
import shutil
import sys

HOST = 'com.frame.downloader'


def uninstall(home=None, user_data_dirs=()):
    home = home or Path.home()
    base = home / 'Library/Application Support'
    browsers = [base / name for name in ('Google/Chrome', 'Chromium', 'Chrome-Video-Debug')]
    for value in user_data_dirs:
        path = Path(value).expanduser()
        if not path.is_absolute():
            raise ValueError('--user-data-dir must be an absolute browser data directory.')
        browsers.append(path)
    removed = []
    for browser in dict.fromkeys(browsers):
        manifest = browser / 'NativeMessagingHosts' / (HOST + '.json')
        if manifest.exists() or manifest.is_symlink():
            manifest.unlink()
            removed.append(manifest)

    folder = base / 'Frame'
    if folder.is_symlink():
        folder.unlink()
        removed.append(folder)
    elif folder.exists():
        # Remove owned files only: a custom download folder or unrelated file
        # inside Frame must survive uninstalling the helper.
        for name in ('frame-helper', 'frame_host.py', 'config.json', 'downloads.json', 'downloads.lock'):
            path = folder / name
            if path.is_file() or path.is_symlink():
                path.unlink()
                removed.append(path)
        for name in ('youtube-cache', '__pycache__'):
            path = folder / name
            if path.is_symlink():
                path.unlink()
                removed.append(path)
            elif path.is_dir():
                shutil.rmtree(path)
                removed.append(path)
        if not any(folder.iterdir()):
            folder.rmdir()
    return removed


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Remove only frame-helper. Stop Frame downloads before running.')
    parser.add_argument('--user-data-dir', action='append', default=[], help='Also remove registration in this custom browser data directory; repeat for multiple directories')
    args = parser.parse_args()
    try:
        if sys.platform != 'darwin':
            raise ValueError('This uninstaller is for macOS.')
        removed = uninstall(user_data_dirs=args.user_data_dir)
        print('frame-helper removed.' if removed else 'frame-helper is already absent from the specified locations.')
        print('The extension, saved videos, and Python/yt-dlp/FFmpeg/Deno are unchanged.')
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
