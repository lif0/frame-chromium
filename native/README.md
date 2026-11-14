# frame-helper — YouTube downloads

**English** · [Русский](README.ru.md) · [Back to Frame](../README.md)

The frame-helper runs locally and is needed **only for YouTube**. HLS and direct media downloads work without it. It requires Python 3, yt-dlp, FFmpeg, and Deno.

Use the extension ID shown on Frame's **Install frame-helper** page, or copy it from `chrome://extensions`. Run the installation command from the project root, which contains the `native` directory. Do not use `dist` as your working directory.

## macOS

Install dependencies with [Homebrew](https://brew.sh/):

```bash
brew install python yt-dlp ffmpeg deno
bash native/install-macos.sh YOUR_EXTENSION_ID
```

The frame-helper is installed in `~/Library/Application Support/Frame`. It registers with Google Chrome and Chromium for the current user, without `sudo`. Downloads open a native save dialog.

Update dependencies with `brew upgrade yt-dlp ffmpeg deno`.

## Linux

For Ubuntu / Debian:

```bash
sudo apt update
sudo apt install python3 pipx ffmpeg
pipx install 'yt-dlp[default]'
pipx ensurepath
```

Install Deno using its [official instructions](https://docs.deno.com/runtime/getting_started/installation/). Other distributions can install Python 3, pipx, and FFmpeg through their package manager, then install yt-dlp with the command above.

Open a new terminal in the project root:

```bash
bash native/install-linux.sh YOUR_EXTENSION_ID
```

The frame-helper is installed in `~/.local/share/frame`; registration goes into `~/.config/google-chrome/NativeMessagingHosts` and `~/.config/chromium/NativeMessagingHosts`. `XDG_DATA_HOME` and `XDG_CONFIG_HOME` overrides are respected.

Use a standard Chrome or Chromium installation. Snap and Flatpak browser packages may prevent the frame-helper from running. Downloads are saved to `~/Downloads`, with a unique filename when one already exists. The show-file action opens the containing folder with `xdg-open`.

Update yt-dlp with `pipx upgrade yt-dlp`; update FFmpeg and Deno using their installation method.

## Windows

Install dependencies in PowerShell with [WinGet](https://learn.microsoft.com/windows/package-manager/winget/):

```powershell
winget install --id Python.Python.3.13 -e
winget install --id yt-dlp.yt-dlp -e
winget install --id Gyan.FFmpeg -e
winget install --id DenoLand.Deno -e
```

Open a **new PowerShell window** in the project root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\native\install-windows.ps1 YOUR_EXTENSION_ID
```

`ExecutionPolicy Bypass` applies to that PowerShell process; it does not change the machine's persistent policy. The frame-helper installer itself does not require administrator privileges.

The frame-helper is installed in `%LOCALAPPDATA%\Frame`. Native Messaging registration is written to `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.frame.downloader` and the corresponding Chromium key. Python runs through a local batch launcher.

Downloads are saved to `Downloads` under your user profile, with unique filenames. The show-file action selects the file in Explorer. If Chrome was running while you installed dependencies, restart it. Update dependencies using `winget upgrade --id PACKAGE_ID -e` for the IDs above.

The installer and Windows code paths are included, but live Windows browser verification is still pending.

## Check the connection

Return to the setup page and click **Check frame-helper**.

If Chrome/Chromium was started with `--user-data-dir` on macOS or Linux, also register frame-helper in that directory. For the macOS debugging profile used in [the tunnel guide](../BROWSER-TUNNEL.md):

```bash
bash native/install-macos.sh YOUR_EXTENSION_ID --user-data-dir "$HOME/Library/Application Support/Chrome-Video-Debug"
```

On Linux use `native/install-linux.sh` with the same option and your actual directory. Use the directory passed to Chrome's `--user-data-dir`, without the `Default` or `Profile 1` suffix. You can find it in the command line on `chrome://version`. Standard profile registrations are kept. Windows uses registry registration and does not need this option.

| Result | Meaning / next step |
| --- | --- |
| **frame-helper was not found.** | No native host is registered. Run the installer for your OS and extension ID. |
| **frame-helper is not connected to this extension…** | Registration exists but does not allow this extension ID. Run the installer again with the current ID. |
| **Missing dependencies: …** | The frame-helper was found, but a listed dependency is missing. Install it and rerun the installer. |
| **frame-helper failed to start or disconnected…** | Registration exists but the process failed. Check Python and reinstall the frame-helper. |
| **frame-helper is connected and ready…** | The frame-helper answered and found its dependencies. You can try a video download. |

A successful check does not guarantee that YouTube will grant access to a particular video. The frame-helper does not read browser cookies. Sign-in requirements, bot checks, live streams, and DRM are not supported.

For official offline viewing, we recommend [YouTube Premium](https://www.youtube.com/premium).

## Local data

- `config.json` contains allowed extension origins, dependency paths, and the default `downloadDir`. The installer merges existing extension IDs and preserves the chosen download directory.
- `downloads.json` keeps up to 100 completed paths for the show-file action; `downloads.lock` coordinates simultaneous jobs.
- Temporary tracks are written alongside the destination and removed on cancellation or failure. macOS replaces an existing file only after a successful download and the native save dialog. Linux and Windows avoid overwriting existing files.
- Commands use argument arrays, not a shell. The frame-helper ignores the user's yt-dlp config and accepts only individual YouTube video URLs.
- Dependency paths are captured during installation, so Chrome does not need to inherit your shell's PATH. Rerun the installer after moving dependencies or updating frame-helper source files.

## Uninstall frame-helper

On macOS, stop active Frame downloads and run from the project root:

```bash
bash native/uninstall-macos.sh
```

This removes frame-helper and its registrations for Chrome, Chromium, and `Chrome-Video-Debug`. For another custom browser data directory, add `--user-data-dir "/absolute/path"`. The extension, saved videos, and installed dependencies are preserved. Running the script again is safe.

On Linux and Windows, remove the native-host registrations listed above and the frame-helper directory. The extension can still download HLS and direct files.
