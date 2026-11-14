import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('frame_uninstall', 'native/uninstall_macos.py')
uninstaller = importlib.util.module_from_spec(spec)
spec.loader.exec_module(uninstaller)


class UninstallerTests(unittest.TestCase):
    def test_removes_helper_and_registrations_preserving_browser_and_videos(self):
        with tempfile.TemporaryDirectory(prefix='frame uninstall ') as temporary:
            home = Path(temporary)
            base = home / 'Library/Application Support'
            custom = home / 'Custom Chrome'
            browsers = [base / name for name in ('Google/Chrome', 'Chromium', 'Chrome-Video-Debug')] + [custom]
            for browser in browsers:
                directory = browser / 'NativeMessagingHosts'
                directory.mkdir(parents=True)
                (directory / 'com.frame.downloader.json').write_text('{}')
                (directory / 'other.helper.json').write_text('{}')
                (browser / 'Preferences').write_text('keep')
            folder = base / 'Frame'
            folder.mkdir()
            for name in ('frame-helper', 'frame_host.py', 'config.json', 'downloads.json', 'downloads.lock'):
                (folder / name).write_text('test')
            (folder / 'youtube-cache').mkdir()
            (folder / 'youtube-cache/video.json').write_text('{}')
            videos = folder / 'Custom Downloads'
            videos.mkdir()
            video = videos / 'saved.mp4'
            video.write_bytes(b'video')
            uninstaller.uninstall(home, [str(custom)])
            for browser in browsers:
                self.assertFalse((browser / 'NativeMessagingHosts/com.frame.downloader.json').exists())
                self.assertTrue((browser / 'NativeMessagingHosts/other.helper.json').exists())
                self.assertEqual((browser / 'Preferences').read_text(), 'keep')
            self.assertEqual(list(folder.iterdir()), [videos])
            self.assertEqual(video.read_bytes(), b'video')
            self.assertEqual(uninstaller.uninstall(home, [str(custom)]), [])

    def test_helper_symlink_is_removed_without_touching_target(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            base = home / 'Library/Application Support'
            base.mkdir(parents=True)
            target = home / 'keep'
            target.mkdir()
            (target / 'frame_host.py').write_text('keep')
            (base / 'Frame').symlink_to(target, target_is_directory=True)
            uninstaller.uninstall(home)
            self.assertFalse((base / 'Frame').is_symlink())
            self.assertEqual((target / 'frame_host.py').read_text(), 'keep')

    def test_relative_custom_directory_is_rejected_before_deletion(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            manifest = home / 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.frame.downloader.json'
            manifest.parent.mkdir(parents=True)
            manifest.write_text('{}')
            with self.assertRaises(ValueError):
                uninstaller.uninstall(home, ['relative/path'])
            self.assertTrue(manifest.exists())


if __name__ == '__main__':
    unittest.main()
