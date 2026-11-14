<div align="center">
  <img src="docs/assets/frame.svg" alt="Frame" width="320">
  <p><strong>Find videos. Choose the quality. Save them locally.</strong></p>
  <p>A lightweight video downloader for Chrome and Chromium.</p>

  ![Version](https://img.shields.io/badge/version-0.1.0-15845d)
  ![Manifest V3](https://img.shields.io/badge/extension-Manifest_V3-4285f4)
  ![Local processing](https://img.shields.io/badge/processing-local-15845d)

  <p><strong>English</strong> · <a href="README.ru.md">Русский</a></p>
  <p><a href="#installation">Install</a> · <a href="#youtube">YouTube setup</a> · <a href="#development">Contribute</a> · <a href="https://github.com/lif0/frame-chromium/issues">Report a bug</a></p>
</div>

## Why Frame?

Frame detects media on the current page and offers a compact list with previews, available quality levels, and download sizes. Downloads from different sites share one manager, with individual progress, cancellation, and retry controls.

- **Choose your quality.** Select available resolutions; your preference is remembered.
- **Know the size.** Exact sizes when available, clearly marked estimates otherwise.
- **Save large videos.** HLS data is streamed to disk, with no fixed 450 MB limit.
- **Keep video and audio together.** Supported HLS tracks are combined into MP4 without re-encoding.
- **Manage downloads in one place.** Run multiple downloads and cancel them independently.
- **Add YouTube support.** An optional local helper connects yt-dlp to the same interface.
- **Keep processing local.** No Frame account, analytics, or upload service.

## Supported media

| Source | Support | Output |
| --- | --- | --- |
| HLS VOD (`.m3u8`) | Unencrypted TS and fragmented MP4, including separate audio | MP4 |
| Direct MP4, WebM, MOV, M4V | Downloadable URLs detected on the page | Original format |
| YouTube videos | Requires the optional helper and dependencies | MP4 |
| Generic DASH (`.mpd`), live streams, DRM | Not supported | — |

Finding a URL does not guarantee that its server will allow a download. Some players expose only the quality currently selected in the player. The extension interface is currently in Russian.

## Installation

Requirements: Chrome or Chromium 116+, Node.js 22+, and npm to build from source.

```bash
git clone https://github.com/lif0/frame-chromium.git
cd frame-chromium
npm ci
npm run build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and choose this project's **`dist`** directory.
3. Pin **Frame** in the browser toolbar.
4. Reload an existing video page and start playback.

This version is installed from source; there is no Chrome Web Store package linked here. After changing the source, rebuild and click **Reload** on Frame's extension card.

## Usage

1. Open Frame on a video page.
2. Select a video and quality, then click **Скачать** (Download).
3. In the shared download manager, click **Начать скачивание** (Start download).
4. Keep the manager tab open until completion. The popup can be closed.

HLS downloads ask where to save the file. Direct files use browser downloads. YouTube uses a save dialog on macOS and the user's `Downloads` folder on Linux and Windows. The icon shows the number of detected videos; it has no counter when none are found.

## YouTube

**YouTube requires an additional installation on each computer.** HLS and direct files do not require the helper.

The helper uses **Python 3**, **yt-dlp** for downloading, **Deno** for YouTube's player JavaScript, and **FFmpeg** to merge audio and video. The setup page has separate instructions for each OS and a connection check.

| OS | Setup | Browser registration |
| --- | --- | --- |
| macOS | [Homebrew + helper](native/README.md#macos) | Chrome / Chromium, current user |
| Linux | [Dependencies + helper](native/README.md#linux) | Standard Chrome / Chromium installations; Snap / Flatpak may block native hosts |
| Windows | [WinGet + helper](native/README.md#windows) | Chrome / Chromium, current user |

Open Frame on YouTube and click **Установить помощник** (Install helper). Use the command shown there: it includes the ID of your installed extension. Once installed, click **Проверить помощник** (Check helper).

The helper does not import browser cookies. Videos requiring sign-in or a bot check may fail. Keep yt-dlp up to date. For official offline viewing, we recommend [YouTube Premium](https://www.youtube.com/premium).

## Privacy and permissions

Frame stores preferences locally and keeps discovered media URLs and job history in the current browser session. There is no Frame backend or analytics. Media requests still go to their original providers.

| Permission | Purpose |
| --- | --- |
| HTTP/HTTPS host access, `webRequest` | Detect media and fetch its files |
| `scripting` | Discover video elements and previews, including in frames |
| `storage` | Save preferences and session data |
| `unlimitedStorage` | Store temporary video tracks on disk |
| `downloads` | Save direct files through the browser |
| `declarativeNetRequestWithHostAccess` | Replay required media access headers for extension requests |
| `nativeMessaging` | Connect to the optional local YouTube helper |

Observed media access headers are scoped to their source CDN and path. Browser cookies are not copied. The helper stores up to 100 completed file paths locally for the **Show file** action. See [helper details](native/README.md#local-data).

## Current limitations

- Early release: site compatibility varies, and YouTube may change its download behavior.
- HLS may need enough free disk space for temporary tracks plus the final MP4. Metadata memory usage grows with video length.
- HLS output is fragmented MP4; older players may have limited compatibility.
- HLS discontinuities, changing initialization maps, encrypted streams, and DRM are unsupported.
- One default audio track is selected; there are no language or subtitle controls yet.
- Closing the manager interrupts unfinished work. Restarting a job downloads it again; resuming from the last byte is not implemented.
- Windows helper code is included, but a real Windows browser/download test is still pending. Automated helper tests use a simulated downloader; they do not establish live YouTube compatibility.

## Development

```bash
npm ci
npm run check
npm test
npm run build
```

Python 3 is required for native-helper tests. FFmpeg and ffprobe enable the real media-remux test; it is skipped if FFmpeg is unavailable.

```text
src/       Extension UI, service worker, media discovery and downloads
native/    YouTube helper and macOS / Linux / Windows installers
scripts/   Build and validation tools
tests/     Media, download, native protocol and installer checks
dist/      Generated unpacked extension (not tracked)
```

Tests cover HLS parsing, size estimates, disk streaming, media remuxing, concurrent jobs, cancellation, helper protocol, and installer registration. Browser and live-site checks are separate. For remote browser development, see [BROWSER-TUNNEL.md](BROWSER-TUNNEL.md).

Bug reports and pull requests are welcome. Include your OS, browser version, Frame version, and steps to reproduce. Remove signed media URLs, access headers, and personal data from logs before sharing them.

## Credits and licensing

HLS remuxing uses [Mediabunny](https://github.com/Vanilagy/mediabunny) under MPL-2.0. Its license is included in the build. The optional helper uses separately installed [yt-dlp](https://github.com/yt-dlp/yt-dlp), [FFmpeg](https://ffmpeg.org/), and [Deno](https://deno.com/), under their respective licenses.

A license for Frame's own source code has not been selected yet.
