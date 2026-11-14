import importlib.util
import json
import os
from pathlib import Path
import selectors
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('frame_install', 'native/install.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
EXTENSION = 'a' * 32


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='frame installer ')
        self.root = Path(self.temp.name)
        self.home = self.root / 'profile with spaces'
        self.home.mkdir()
        binary = self.root / 'bin'; binary.mkdir()
        self.programs = {}
        for name in ('yt-dlp', 'ffmpeg', 'deno'):
            path = binary / name
            path.write_text('#!' + sys.executable + '\nprint("test-version")\n')
            path.chmod(0o755)
            self.programs[name] = str(path)
        self.env = mock.patch.dict(os.environ, {
            'XDG_DATA_HOME': str(self.root / 'data'),
            'XDG_CONFIG_HOME': str(self.root / 'config'),
            'LOCALAPPDATA': str(self.root / 'AppData'),
        })
        self.env.start()
        self.which = mock.patch.object(installer.shutil, 'which', side_effect=lambda name, **kwargs: self.programs[name])
        self.which.start()

    def tearDown(self):
        self.which.stop(); self.env.stop(); self.temp.cleanup()

    def test_linux_registration_launches_real_host_and_preserves_configuration(self):
        folder = installer.install([EXTENSION], self.home, 'linux')
        manifest = json.loads((self.root / 'config/google-chrome/NativeMessagingHosts/com.frame.downloader.json').read_text())
        self.assertEqual(manifest['allowed_origins'], ['chrome-extension://' + EXTENSION + '/'])
        self.assertTrue(Path(manifest['path']).is_file())
        host = subprocess.Popen([manifest['path'], manifest['allowed_origins'][0]], stdin=subprocess.PIPE,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            payload = json.dumps({'action': 'ping'}).encode()
            host.stdin.write(struct.pack('<I', len(payload)) + payload); host.stdin.flush()
            with selectors.DefaultSelector() as selector:
                selector.register(host.stdout, selectors.EVENT_READ)
                self.assertTrue(selector.select(timeout=5), 'Installed launcher did not answer')
            length = struct.unpack('<I', host.stdout.read(4))[0]
            result = json.loads(host.stdout.read(length))
            self.assertEqual(result['result']['version'], '0.1.0')
            self.assertEqual(result['result']['ytdlpVersion'], 'test-version')
        finally:
            host.stdin.close(); host.wait(timeout=5)
            host.stdout.close(); host.stderr.close()
        config_file = folder / 'config.json'
        config = json.loads(config_file.read_text()); config['downloadDir'] = str(self.root / 'Custom')
        config_file.write_text(json.dumps(config))
        installer.install(['b' * 32], self.home, 'linux')
        updated = json.loads(config_file.read_text())
        self.assertEqual(updated['downloadDir'], config['downloadDir'])
        self.assertEqual(len(updated['allowedOrigins']), 2)
        self.assertEqual(updated['programs'], self.programs)

    def test_macos_registration_uses_user_chrome_and_chromium_paths(self):
        folder = installer.install([EXTENSION], self.home, 'darwin')
        self.assertEqual(folder, self.home / 'Library/Application Support/Frame')
        for browser in ('Google/Chrome', 'Chromium'):
            path = self.home / 'Library/Application Support' / browser / 'NativeMessagingHosts/com.frame.downloader.json'
            self.assertTrue(path.is_file())
            self.assertEqual(json.loads(path.read_text())['path'], str(folder / 'frame-helper'))

    def test_windows_registration_uses_hkcu_and_quoted_launcher(self):
        registry = mock.MagicMock()
        with mock.patch.dict(sys.modules, {'winreg': registry}):
            folder = installer.install([EXTENSION], self.home, 'win32')
        keys = [call.args[1] for call in registry.CreateKey.call_args_list]
        self.assertEqual(keys, [r'Software\Google\Chrome\NativeMessagingHosts\com.frame.downloader', r'Software\Chromium\NativeMessagingHosts\com.frame.downloader'])
        self.assertTrue(all(call.args[0] == registry.HKEY_CURRENT_USER for call in registry.CreateKey.call_args_list))
        self.assertIn('"%~dp0frame_host.py" %*', (folder / 'frame-helper.bat').read_text())
        manifest = json.loads((folder / 'com.frame.downloader.json').read_text())
        self.assertEqual(manifest['path'], str(folder / 'frame-helper.bat'))

    def test_invalid_id_or_missing_dependencies_do_not_create_registration(self):
        with self.assertRaises(ValueError):
            installer.install(['not-an-extension'], self.home, 'linux')
        with mock.patch.object(installer.shutil, 'which', return_value=None):
            with self.assertRaisesRegex(ValueError, 'Missing dependencies: yt-dlp, ffmpeg, deno'):
                installer.install([EXTENSION], self.home, 'linux')
        self.assertFalse((self.root / 'config').exists())
        self.assertFalse((self.root / 'data').exists())


if __name__ == '__main__':
    unittest.main()
