import json
import importlib.util
import os
from pathlib import Path
import selectors
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import unittest

ORIGIN = 'chrome-extension://' + 'a' * 32 + '/'
FAKE = r'''
import json, pathlib, signal, sys, time
args=sys.argv[1:]
if '--version' in args:
    print('test-version'); sys.exit(0)
assert '--ignore-config' in args and '--no-playlist' in args
if args[-1].endswith('errortest01'):
    print('[download] Got error: Connection timed out. Retrying (2/2)...', file=sys.stderr)
    print('ERROR: ', file=sys.stderr)
    sys.exit(1)
if '--dump-single-json' in args:
    with (pathlib.Path(__file__).parent.parent/'extractions.log').open('a') as log: log.write('extract\n')
    print(json.dumps({'id':'q6fgVVmdpgY','title':'Test video','duration':20,'formats':[{'format_id':'18','height':360,'vcodec':'avc1','acodec':'aac','filesize':2048,'url':'secret-url'}]})); sys.exit(0)
if '--load-info-json' in args:
    data=json.loads(pathlib.Path(args[args.index('--load-info-json')+1]).read_text())
    assert data['id']=='q6fgVVmdpgY'
    assert args[args.index('--format')+1]=='18'
    (pathlib.Path(__file__).parent.parent/'used-cache').write_text('yes')
if args[-1].endswith('slowtest001'):
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
print('FRAME_PROGRESS:'+json.dumps({'formatId':'137','downloaded':1024,'total':2048}),flush=True)
if args[-1].endswith('slowtest001'):
    time.sleep(30)
path=pathlib.Path(args[args.index('--output')+1].replace('%(ext)s','mp4'))
path.write_bytes(b'x'*2048)
print('FRAME_FILE:'+json.dumps(str(path)),flush=True)
'''


class NativeHostTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.downloads = self.root / 'Downloads'
        self.downloads.mkdir()
        shutil.copy2('native/frame_host.py', self.root / 'frame_host.py')
        (self.root / 'config.json').write_text(json.dumps({'allowedOrigins': [ORIGIN], 'downloadDir': str(self.downloads)}))
        binary = self.root / 'bin'; binary.mkdir()
        for name in ('yt-dlp', 'ffmpeg', 'deno'):
            file = binary / name
            file.write_text('#!' + sys.executable + '\n' + FAKE)
            file.chmod(0o755)
        self.env = dict(os.environ, PATH=str(binary) + ':' + os.environ.get('PATH', ''))
        self.hosts = []

    def tearDown(self):
        for host in self.hosts:
            if host.poll() is None:
                host.stdin.close(); host.wait(timeout=6)
            else:
                host.stdin.close()
            host.stdout.close(); host.stderr.close()
        self.temp.cleanup()

    def start(self, origin=ORIGIN):
        host = subprocess.Popen([sys.executable, str(self.root / 'frame_host.py'), origin], stdin=subprocess.PIPE,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=self.env, bufsize=0)
        self.hosts.append(host)
        return host

    def send(self, host, message):
        body = json.dumps(message).encode()
        host.stdin.write(struct.pack('<I', len(body)) + body); host.stdin.flush()

    def receive(self, host):
        with selectors.DefaultSelector() as selector:
            selector.register(host.stdout, selectors.EVENT_READ)
            self.assertTrue(selector.select(timeout=8), 'Native host timed out')
        header = host.stdout.read(4)
        self.assertEqual(len(header), 4)
        length = struct.unpack('<I', header)[0]
        data = bytearray()
        while len(data) < length:
            chunk = host.stdout.read(length - len(data))
            self.assertTrue(chunk)
            data.extend(chunk)
        return json.loads(data)

    def terminal(self, host):
        while True:
            result = self.receive(host)
            if result['type'] != 'progress':
                return result

    def test_info_strips_urls(self):
        host = self.start()
        self.send(host, {'action': 'info', 'url': 'https://www.youtube.com/watch?v=q6fgVVmdpgY'})
        result = self.terminal(host)
        self.assertEqual(result['type'], 'result')
        self.assertEqual(result['result']['formats'][0]['height'], 360)
        self.assertNotIn('secret-url', json.dumps(result))

    def test_download_preserves_retry_reason_before_empty_error(self):
        host = self.start()
        self.send(host, {'action': 'download', 'url': 'https://youtu.be/errortest01', 'formatId': '18', 'filename': 'error.mp4'})
        result = self.terminal(host)
        self.assertEqual(result['type'], 'error')
        self.assertIn('Connection timed out', result['message'])
        self.assertEqual(list(self.downloads.iterdir()), [])

    def test_two_downloads_never_overwrite_each_other(self):
        hosts = [self.start(), self.start()]
        for host in hosts:
            self.send(host, {'action': 'download', 'url': 'https://youtu.be/q6fgVVmdpgY', 'formatId': '137+140', 'filename': '../movie.mp4', 'saveAs': False})
        results = [self.terminal(host) for host in hosts]
        self.assertTrue(all(r['type'] == 'result' for r in results), results)
        self.assertNotEqual(results[0]['result']['filename'], results[1]['result']['filename'])
        self.assertEqual(sorted(p.stat().st_size for p in self.downloads.iterdir()), [2048, 2048])
        self.assertEqual(len(json.loads((self.root / 'downloads.json').read_text())), 2)

    def test_cached_info_survives_new_host_and_is_used_for_download(self):
        for _ in range(2):
            host = self.start()
            self.send(host, {'action': 'info', 'url': 'https://youtu.be/q6fgVVmdpgY'})
            self.assertEqual(self.terminal(host)['type'], 'result')
        self.assertEqual((self.root / 'extractions.log').read_text().count('extract'), 1)
        self.send(host, {'action': 'download', 'url': 'https://youtu.be/q6fgVVmdpgY', 'formatId': '18', 'filename': 'cached.mp4'})
        self.assertEqual(self.terminal(host)['type'], 'result')
        self.assertTrue((self.root / 'used-cache').is_file())
        cached = self.root / 'youtube-cache/q6fgVVmdpgY.json'
        os.utime(cached, (time.time() - 300, time.time() - 300))
        self.send(host, {'action': 'info', 'url': 'https://youtu.be/q6fgVVmdpgY'})
        self.assertEqual(self.terminal(host)['type'], 'result')
        self.assertEqual((self.root / 'extractions.log').read_text().count('extract'), 1)
        os.utime(cached, (time.time() - 601, time.time() - 601))
        self.send(host, {'action': 'info', 'url': 'https://youtu.be/q6fgVVmdpgY'})
        self.assertEqual(self.terminal(host)['type'], 'result')
        self.assertEqual((self.root / 'extractions.log').read_text().count('extract'), 2)
        self.send(host, {'action': 'info', 'url': 'https://youtu.be/q6fgVVmdpgY', 'refresh': True})
        self.assertEqual(self.terminal(host)['type'], 'result')
        self.assertEqual((self.root / 'extractions.log').read_text().count('extract'), 3)

    def test_silent_process_times_out_and_is_reaped(self):
        spec = importlib.util.spec_from_file_location('host_timeout', 'native/frame_host.py')
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        host = module.Host({}, emit=lambda value: None)
        started = time.monotonic()
        with self.assertRaises(module.HostError) as error:
            host.run([sys.executable, '-c', 'import time; time.sleep(30)'], idle_timeout=0.1)
        self.assertEqual(error.exception.code, 'TIMEOUT')
        self.assertLess(time.monotonic() - started, 3)
        self.assertIsNone(host.process)

    def test_disconnected_browser_does_not_print_broken_pipe_traceback(self):
        host = self.start()
        host.stdout.close()
        self.send(host, {'action': 'ping'})
        host.stdin.close()
        self.assertEqual(host.wait(timeout=6), 0)
        self.assertNotIn('BrokenPipeError', host.stderr.read().decode())

    def test_cancel_kills_downloader_and_cleans_temporary_files(self):
        host = self.start()
        self.send(host, {'action': 'download', 'url': 'https://youtu.be/slowtest001', 'formatId': '137+140', 'filename': 'cancel.mp4', 'saveAs': False})
        while True:
            result = self.receive(host)
            if result.get('update', {}).get('downloaded'):
                break
        self.send(host, {'action': 'cancel'})
        self.assertEqual(self.terminal(host)['code'], 'CANCELED')
        self.assertEqual(list(self.downloads.iterdir()), [])

    def test_untrusted_urls_and_origins_are_rejected(self):
        host = self.start()
        self.send(host, {'action': 'info', 'url': 'https://youtube.com.evil.test/watch?v=q6fgVVmdpgY'})
        self.assertEqual(self.terminal(host)['code'], 'INVALID_REQUEST')
        other = self.start('chrome-extension://' + 'b' * 32 + '/')
        self.assertEqual(other.wait(timeout=5), 1)


class ErrorMessageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('host_errors', 'native/frame_host.py')
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def test_multiline_error_and_ansi(self):
        message = self.module.useful_error(['\x1b[31mERROR:\x1b[0m ', 'Unable to download video data:', 'HTTP Error 403: Forbidden'], 1)
        self.assertEqual(message, 'Unable to download video data:\nHTTP Error 403: Forbidden')

    def test_empty_error_does_not_hide_earlier_reason(self):
        message = self.module.useful_error(['ERROR: HTTP Error 429: Too Many Requests', '[download] Retrying (2/2)...', 'ERROR: '], 1)
        self.assertIn('429', message)
        self.assertNotIn('Retrying', message)

    def test_empty_error_has_useful_fallback(self):
        for lines in [[], ['ERROR: '], ['[download] Destination: /Users/person/private.mp4', 'ERROR: ']]:
            with self.subTest(lines=lines):
                self.assertEqual(self.module.useful_error(lines, 1), 'yt-dlp завершился с ошибкой (код 1).')

    def test_diagnostics_redact_urls_headers_and_personal_paths(self):
        message = self.module.useful_error(['ERROR:', 'HTTP Error 403: https://video.test/file?token=secret',
                                           'Cookie: SID=secret', 'Authorization: Bearer secret',
                                           'Cannot write /Users/person/Downloads/private.mp4',
                                           r'Cannot write C:\Users\person\Downloads\private.mp4'], 1)
        self.assertIn('403', message)
        for private in ['secret', 'person', 'private.mp4', 'video.test']:
            self.assertNotIn(private, message)

    def test_sign_in_error_remains_recognizable(self):
        self.assertIn('YouTube запросил проверку входа', self.module.useful_error(['ERROR: Sign in to confirm you’re not a bot'], 1))


if __name__ == '__main__':
    unittest.main()
