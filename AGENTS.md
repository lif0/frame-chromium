# Repository Guidelines

## Project Structure & Module Organization

Frame is a Chromium Manifest V3 extension. `src/` contains the service worker (`background.js`), discovery (`detect.js`), popup, shared download manager, and media modules. `native/` contains the Python YouTube frame-helper and OS-specific installers. Build tools live in `scripts/`; tests live in `tests/`. Documentation assets are in `docs/assets/`. `dist/` is generated and ignored by Git; edit `src/`, then rebuild.

## Build, Test, and Development Commands

Use Node.js 22+, npm, and Python 3.

- `npm ci`: install locked dependencies.
- `npm run build`: generate the unpacked extension in `dist/`, including icons and bundled Mediabunny.
- `npm run check`: check JavaScript syntax and manifest entry-point files.
- `npm test`: rebuild and run the Node test suite, including Python native-helper tests.
- `python3 -B -m unittest discover -s tests -p 'native*_test.py'`: run helper and installer tests directly.

Load `dist/` through **Load unpacked** in `chrome://extensions`. After source changes, rebuild and reload the extension. Reinstall frame-helper after changing native code. Installation instructions are in `native/README.md`.

## Coding Style & Naming Conventions

Follow surrounding code: JavaScript uses ES modules, two-space indentation, single quotes, semicolons, and camelCase identifiers. Python uses four-space indentation and snake_case. Prefer descriptive hyphenated JavaScript filenames such as `youtube-info.js`. No formatter or lint framework is configured; avoid unrelated formatting changes.

Keep interface text bilingual through `src/translations.js` and `src/i18n.js`; manifest messages live in `src/_locales/`.

## Testing Guidelines

JavaScript tests use `node:test` and strict assertions in `tests/*.test.mjs`. Python uses `unittest` in `tests/native*_test.py`. Add regression tests for changed behavior, especially cancellation, concurrent downloads, protocol handling, and cache expiry. No numeric coverage threshold is configured.

Install FFmpeg and ffprobe for media-remux verification; that test skips when FFmpeg is unavailable. Simulated downloader tests do not establish live YouTube compatibility. Report browser checks separately.

## Commit & Pull Request Guidelines

Recent commits use imperative Conventional Commit subjects: `feat: release v0.1.0` and `fix: stabilize YouTube downloads and cache video metadata`. Follow this pattern.

PRs should describe the problem, resulting behavior, and validation. Link relevant issues, include screenshots for UI changes, and identify OS/browser versions for compatibility fixes. Redact signed media URLs, access headers, and personal data from shared logs.
