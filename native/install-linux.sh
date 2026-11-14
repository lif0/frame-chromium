#!/bin/bash
set -euo pipefail
if [[ "$(uname -s)" != "Linux" ]]; then
  echo 'This installer is for Linux.' >&2
  exit 1
fi
frame_source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$frame_source_dir/install.py" "$@"
