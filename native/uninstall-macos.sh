#!/bin/bash
set -euo pipefail
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo 'This uninstaller is for macOS.' >&2
  exit 1
fi
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
frame_source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$frame_source_dir/uninstall_macos.py" "$@"
