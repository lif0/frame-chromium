# Frame YouTube helper

**English** · [Русский](README.ru.md) · [Back to Frame](../README.md)

The helper runs locally and is needed **only for YouTube**. HLS and direct media downloads work without it. It requires Python 3, yt-dlp, FFmpeg, and Deno.

Use the extension ID shown on Frame's **Install helper** page, or copy it from `chrome://extensions`. Run the installation command from the project root, which contains the `native` directory. Do not use `dist` as your working directory.

## macOS

Install dependencies with [Homebrew](https://brew.sh/):

```bash
brew install python yt-dlp ffmpeg deno
bash native/install-macos.sh YOUR_EXTENSION_ID
```

The helper is installed in `~/Library/Application Support/Frame`. It registers with Google Chrome and Chromium for the current user, without `sudo`. Downloads open a native save dialog.

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

The helper is installed in `~/.local/share/frame`; registration goes into `~/.config/google-chrome/NativeMessagingHosts` and `~/.config/chromium/NativeMessagingHosts`. `XDG_DATA_HOME` and `XDG_CONFIG_HOME` overrides are respected.

Use a standard Chrome or Chromium installation. Snap and Flatpak browser packages may prevent the helper from running. Downloads are saved to `~/Downloads`, with a unique filename when one already exists. The show-file action opens the containing folder with `xdg-open`.

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

`ExecutionPolicy Bypass` applies to that PowerShell process; it does not change the machine's persistent policy. The helper installer itself does not require administrator privileges.

The helper is installed in `%LOCALAPPDATA%\Frame`. Native Messaging registration is written to `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.frame.downloader` and the corresponding Chromium key. Python runs through a local batch launcher.

Downloads are saved to `Downloads` under your user profile, with unique filenames. The show-file action selects the file in Explorer. If Chrome was running while you installed dependencies, restart it. Update dependencies using `winget upgrade --id PACKAGE_ID -e` for the IDs above.

The installer and Windows code paths are included, but live Windows browser verification is still pending.

## Check the connection

Return to the setup page and click **Проверить помощник** (Check helper).

| Result | Meaning / next step |
| --- | --- |
| **Помощник не найден.** | No native host is registered. Run the installer for your OS and extension ID. |
| **Помощник не подключён к этому расширению…** | Registration exists but does not allow this extension ID. Run the installer again with the current ID. |
| **Не установлены: …** | The helper was found, but a listed dependency is missing. Install it and rerun the installer. |
| **Помощник не запустился или отключился…** | Registration exists but the process failed. Check Python and reinstall the helper. |
| **Помощник найден и готов к работе…** | The helper answered and found its dependencies. You can try a video download. |

A successful check does not guarantee that YouTube will grant access to a particular video. The helper does not read browser cookies. Sign-in requirements, bot checks, live streams, and DRM are not supported.

For official offline viewing, we recommend [YouTube Premium](https://www.youtube.com/premium).

## Local data

- `config.json` contains allowed extension origins, dependency paths, and the default `downloadDir`. The installer merges existing extension IDs and preserves the chosen download directory.
- `downloads.json` keeps up to 100 completed paths for the show-file action; `downloads.lock` coordinates simultaneous jobs.
- Temporary tracks are written alongside the destination and removed on cancellation or failure. macOS replaces an existing file only after a successful download and the native save dialog. Linux and Windows avoid overwriting existing files.
- Commands use argument arrays, not a shell. The helper ignores the user's yt-dlp config and accepts only individual YouTube video URLs.
- Dependency paths are captured during installation, so Chrome does not need to inherit your shell's PATH. Rerun the installer after moving dependencies or updating helper source files.

To uninstall, remove the native-host registrations listed for your OS and the Frame helper directory. Saved videos are separate and remain in place. The extension can still download HLS and direct files.
