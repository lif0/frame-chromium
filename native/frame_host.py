#!/usr/bin/env python3
"""Frame Native Messaging host. yt-dlp/FFmpeg run locally; stdout is protocol only."""
import collections
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import parse_qs, urlparse
import uuid

ROOT = Path(__file__).resolve().parent
if sys.platform != 'win32':
    os.environ['PATH'] = os.pathsep.join([os.environ.get('PATH', ''), '/opt/homebrew/bin', '/usr/local/bin', str(Path.home() / '.local/bin'), str(Path.home() / '.deno/bin')])
OUTPUT_LOCK = threading.Lock()
OUTPUT_CLOSED = threading.Event()


@contextmanager
def registry_lock():
    # A separate lock file works with both flock and Windows byte-range locks.
    with (ROOT / 'downloads.lock').open('a+b') as lock:
        if sys.platform == 'win32':
            import msvcrt
            if lock.seek(0, os.SEEK_END) == 0:
                lock.write(b'\0'); lock.flush()
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
            try:
                yield
            finally:
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX)
            yield


def stop_process(process, force=False):
    if process.poll() is not None:
        return
    if sys.platform == 'win32':
        # Terminate yt-dlp and its FFmpeg child, without opening a console.
        subprocess.run(['taskkill.exe', '/PID', str(process.pid), '/T', '/F'],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       creationflags=subprocess.CREATE_NO_WINDOW, timeout=3, check=False)
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL if force else signal.SIGTERM)
        except ProcessLookupError:
            pass


class HostError(Exception):
    def __init__(self, message, code='DOWNLOAD_FAILED'):
        super().__init__(message)
        self.code = code


def canonical_url(value):
    if not isinstance(value, str):
        raise HostError('Некорректная ссылка YouTube.', 'INVALID_REQUEST')
    url = urlparse(value)
    if url.scheme not in ('https', 'http') or url.username or url.password:
        raise HostError('Некорректная ссылка YouTube.', 'INVALID_REQUEST')
    video_id = None
    if url.hostname == 'youtu.be':
        video_id = url.path.strip('/').split('/')[0]
    elif url.hostname in ('youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'):
        if url.path == '/watch':
            video_id = parse_qs(url.query).get('v', [None])[0]
        elif re.match(r'^/(shorts|live|embed)/', url.path):
            video_id = url.path.split('/')[2]
    if not re.fullmatch(r'[\w-]{11}', video_id or '', re.ASCII):
        raise HostError('Нужна ссылка на отдельный ролик YouTube.', 'INVALID_REQUEST')
    return 'https://www.youtube.com/watch?v=' + video_id


def send(message):
    data = json.dumps(message, ensure_ascii=False, allow_nan=False).encode('utf-8')
    if len(data) > 1024 * 1024:
        raise HostError('Ответ frame-helper слишком большой.')
    with OUTPUT_LOCK:
        if OUTPUT_CLOSED.is_set():
            return
        try:
            sys.stdout.buffer.write(struct.pack('<I', len(data)) + data)
            sys.stdout.buffer.flush()
        except BrokenPipeError:
            OUTPUT_CLOSED.set()
            # Avoid a second exception when Python flushes stdout on exit.
            with open(os.devnull, 'wb') as sink:
                os.dup2(sink.fileno(), sys.stdout.fileno())


def read_exact(stream, length):
    chunks = bytearray()
    while len(chunks) < length:
        chunk = stream.read(length - len(chunks))
        if not chunk:
            return None
        chunks.extend(chunk)
    return bytes(chunks)


def safe_filename(value):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', str(value or 'YouTube видео'))
    name = name.strip('. ')[:160] or 'YouTube видео'
    if re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)', name, re.I):
        name = '_' + name
    return name if name.lower().endswith('.mp4') else name + '.mp4'


def dependencies(config):
    saved = config.get('programs', {})
    found = {name: saved.get(name) if saved.get(name) and Path(saved[name]).is_file() else shutil.which(name) for name in ('yt-dlp', 'ffmpeg', 'deno')}
    missing = [name for name, path in found.items() if not path]
    if missing:
        raise HostError('Не установлены: ' + ', '.join(missing) + '. Откройте настройку frame-helper.', 'DEPENDENCY_MISSING')
    return found


def useful_error(lines, exit_code=None):
    # yt-dlp can put the reason on the next line, or end retries with a bare ERROR:.
    lines = [re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', line).strip() for line in lines]
    text = '\n'.join(lines)[-4000:]
    if 'Sign in to confirm' in text or 'not a bot' in text:
        return 'YouTube запросил проверку входа или проверку «не робот». Автоматическая загрузка этого ролика сейчас недоступна.'
    if 'Requested format is not available' in text:
        return 'Выбранное качество больше недоступно. Обновите список и выберите качество заново.'
    if 'Private video' in text or 'members-only' in text or 'DRM' in text:
        return 'Этот ролик закрыт или защищён. frame-helper не получил доступ к скачиванию.'
    detail = ''
    for index in reversed(range(len(lines))):
        if 'ERROR:' not in lines[index]:
            continue
        parts = [lines[index].split('ERROR:', 1)[1].strip()]
        for line in lines[index + 1:]:
            if re.match(r'(?:\[(?!Errno\b)|FRAME_|ERROR:|WARNING:)', line):
                break
            if line:
                parts.append(line)
        detail = '\n'.join(part for part in parts if part)
        if detail:
            break
    if not detail:
        reasons = [line for line in lines if re.search(r'(?i)(?:got error:|warning:|exception|timed? out|HTTP Error|unable to|failed to)', line)
                   and not line.startswith('FRAME_')]
        detail = reasons[-1] if reasons else ''
    if not detail:
        return f'yt-dlp завершился с ошибкой (код {exit_code}).' if exit_code is not None else 'yt-dlp завершился с ошибкой.'
    # Never expose signed URLs, access headers, or personal home-directory paths.
    detail = re.sub(r'https?://\S+', '[адрес]', detail)
    detail = re.sub(r'(?im)\b(?:cookie|set-cookie|authorization|proxy-authorization)\s*[:=][^\n]*', '[скрыто]', detail)
    detail = re.sub(r'(?:/(?:Users|home)/[^\s\"\']+|[A-Za-z]:\\Users\\[^\r\n\"\']+)', '[путь]', detail)
    return detail[:700]


class Host:
    def __init__(self, config, emit=send):
        self.config = config
        self.emit = emit
        self.canceled = threading.Event()
        self.process_lock = threading.Lock()
        self.process = None
        self.thread = None
        self.language = 'en'

    def cancel(self):
        self.canceled.set()
        with self.process_lock:
            process = self.process
            if process and process.poll() is None:
                stop_process(process)
                # A downloader may ignore SIGTERM while blocked. Do not leave it
                # running after the manager or native port has closed.
                def force_stop():
                    stop_process(process, force=True)
                timer = threading.Timer(2, force_stop)
                timer.daemon = True
                timer.start()

    def run(self, argv, on_line=None, idle_timeout=None):
        with self.process_lock:
            if self.canceled.is_set():
                raise HostError('Загрузка отменена.', 'CANCELED')
            options = {'creationflags': subprocess.CREATE_NO_WINDOW} if sys.platform == 'win32' else {'start_new_session': True}
            process = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                       text=True, encoding='utf-8', errors='replace', **options)
            self.process = process
        lines = collections.deque(maxlen=30)
        collected = []
        total = 0
        last_output = time.monotonic()
        finished = threading.Event()
        timed_out = threading.Event()
        def watch():
            while not finished.wait(min(1, idle_timeout)):
                if time.monotonic() - last_output >= idle_timeout:
                    timed_out.set()
                    stop_process(process, force=True)
                    return
        watchdog = threading.Thread(target=watch, daemon=True) if idle_timeout else None
        if watchdog:
            watchdog.start()
        try:
            for line in process.stdout:
                last_output = time.monotonic()
                line = line.rstrip('\r\n')
                if on_line:
                    on_line(line)
                else:
                    total += len(line)
                    if total > 16 * 1024 * 1024:
                        self.cancel()
                        raise HostError('Ответ yt-dlp слишком большой.')
                    collected.append(line)
                lines.append(line)
            code = process.wait()
            if self.canceled.is_set():
                raise HostError('Загрузка отменена.', 'CANCELED')
            if timed_out.is_set():
                raise HostError('YouTube долго не передаёт данные. Проверьте соединение и повторите попытку.', 'TIMEOUT')
            if code:
                raise HostError(useful_error(lines, code))
            return '\n'.join(collected)
        finally:
            finished.set()
            if watchdog:
                watchdog.join()
            if process.poll() is None:
                try:
                    stop_process(process)
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    stop_process(process, force=True)
                    process.wait()
                except ProcessLookupError:
                    pass
            process.stdout.close()
            with self.process_lock:
                if self.process is process:
                    self.process = None

    def command(self):
        programs = dependencies(self.config)
        return [programs['yt-dlp'], '--ignore-config', '--no-playlist', '--no-warnings',
                '--socket-timeout', '15', '--retries', '2', '--fragment-retries', '2', '--extractor-retries', '2',
                '--abort-on-unavailable-fragments', '--js-runtimes', 'deno:' + programs['deno'],
                '--ffmpeg-location', programs['ffmpeg']]

    def cache_path(self, url):
        folder = ROOT / 'youtube-cache'
        folder.mkdir(mode=0o700, exist_ok=True)
        # Canonical URL guarantees a safe, fixed-length filename.
        return folder / (canonical_url(url).split('v=')[1] + '.json')

    def cached_info(self, url):
        path = self.cache_path(url)
        try:
            if not 0 <= time.time() - path.stat().st_mtime < 600:
                return None
            data = json.loads(path.read_text(encoding='utf-8'))
            return data if data.get('id') == url.split('v=')[1] else None
        except (OSError, ValueError, AttributeError):
            return None

    def save_info(self, url, data):
        path = self.cache_path(url)
        # Atomic publication keeps concurrent helper processes from reading half a JSON.
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, delete=False) as file:
            temporary = Path(file.name)
            json.dump(data, file)
        try:
            os.replace(temporary, path)
            for old in sorted(path.parent.glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True)[20:]:
                old.unlink(missing_ok=True)
        finally:
            temporary.unlink(missing_ok=True)

    def info(self, message):
        url = canonical_url(message.get('url'))
        data = None if message.get('refresh') else self.cached_info(url)
        if data is None:
            data = json.loads(self.run(self.command() + ['--dump-single-json', '--skip-download', '--', url], idle_timeout=50))
            self.save_info(url, data)
        fields = ('format_id', 'height', 'fps', 'ext', 'vcodec', 'acodec', 'filesize', 'filesize_approx',
                  'tbr', 'abr', 'language_preference', 'has_drm')
        return {'videoId': data['id'], 'title': data.get('title', 'YouTube видео'),
                'thumbnail': data.get('thumbnail', ''), 'duration': data.get('duration') or 0,
                'isLive': data.get('is_live', False),
                'formats': [{key: f.get(key) for key in fields} for f in data.get('formats', [])[:1000]]}

    def choose_destination(self, filename, save_as):
        folder = Path(self.config.get('downloadDir', str(Path.home() / 'Downloads'))).expanduser()
        folder.mkdir(parents=True, exist_ok=True)
        if save_as and sys.platform == 'darwin':
            self.emit({'type': 'progress', 'update': {'status': 'Выберите место сохранения…'}})
            prompt = 'Сохранить видео YouTube' if self.language == 'ru' else 'Save YouTube video'
            script = 'on run argv\nreturn POSIX path of (choose file name with prompt (item 2 of argv) default name (item 1 of argv) default location (path to downloads folder))\nend run'
            try:
                path = self.run(['/usr/bin/osascript', '-e', script, filename, prompt]).strip()
            except HostError as error:
                if '-128' in str(error):
                    raise HostError('Сохранение отменено.', 'CANCELED') from error
                raise
            return Path(path if path.lower().endswith('.mp4') else path + '.mp4')
        path = folder / filename
        index = 2
        while path.exists():
            path = folder / (Path(filename).stem + f' ({index}).mp4')
            index += 1
        return path

    def remember(self, path):
        file_id = str(uuid.uuid4())
        registry = ROOT / 'downloads.json'
        with registry_lock(), registry.open('a+', encoding='utf-8') as file:
            os.chmod(registry, 0o600)
            file.seek(0)
            try:
                entries = json.load(file)
            except (ValueError, TypeError):
                entries = {}
            entries[file_id] = str(path)
            entries = dict(list(entries.items())[-100:])
            file.seek(0); file.truncate(); json.dump(entries, file, ensure_ascii=False); file.flush()
        return file_id

    def download(self, message):
        url = canonical_url(message.get('url'))
        selector = message.get('formatId', '')
        if not isinstance(selector, str) or not re.fullmatch(r'[\w.-]+(?:\+[\w.-]+)?', selector, re.ASCII):
            raise HostError('Некорректное качество. Обновите список.', 'INVALID_REQUEST')
        command = self.command()
        destination = self.choose_destination(safe_filename(message.get('filename')), bool(message.get('saveAs')))
        totals, received = {}, {}
        completed_file = None
        expected = message.get('expectedBytes')
        expected = expected if isinstance(expected, (int, float)) and expected > 0 else 0
        highest = 0
        self.emit({'type': 'progress', 'update': {'status': 'Получаем ссылку YouTube…', 'progress': 1}})
        def progress(line):
            nonlocal completed_file, highest
            if line.startswith('FRAME_FILE:'):
                completed_file = Path(json.loads(line[len('FRAME_FILE:'):]))
            elif line.startswith('FRAME_PROGRESS:'):
                data = json.loads(line[len('FRAME_PROGRESS:'):])
                key = str(data.get('formatId', 'video'))
                received[key] = float(data.get('downloaded') or 0)
                totals[key] = float(data.get('total') or 0)
                downloaded = sum(received.values())
                total = max(expected, sum(totals.values()))
                highest = max(highest, min(95, downloaded / total * 95 if total else 1))
                self.emit({'type': 'progress', 'update': {'status': 'Скачиваем YouTube…', 'downloaded': downloaded,
                           'progress': highest, 'speed': data.get('speed') or 0, 'eta': data.get('eta')}})
            elif line.startswith('FRAME_POST:'):
                self.emit({'type': 'progress', 'update': {'status': 'Собираем MP4…', 'progress': max(highest, 96), 'speed': 0, 'eta': None}})
            elif line.startswith('[youtube'):
                status = 'YouTube: обрабатываем плеер…' if any(part in line for part in ('player', 'challenge', 'JavaScript')) else 'YouTube: получаем данные ролика…'
                self.emit({'type': 'progress', 'update': {'status': status}})
            elif line.startswith('[download]') and ('Retry' in line or 'retry' in line):
                self.emit({'type': 'progress', 'update': {'status': 'YouTube: повторяем соединение…'}})
        with tempfile.TemporaryDirectory(prefix='.frame-', dir=destination.parent) as temporary:
            template = str(Path(temporary)).replace('%', '%%') + '/video.%(ext)s'
            progress_template = 'download:FRAME_PROGRESS:{"formatId":%(info.format_id)j,"downloaded":%(progress.downloaded_bytes|0)j,"total":%(progress.total_bytes,progress.total_bytes_estimate|0)j,"speed":%(progress.speed|0)j,"eta":%(progress.eta|0)j}'
            data = self.cached_info(url)
            source = ['--', url]
            if data is not None:
                cached = Path(temporary) / 'source.json'
                cached.write_text(json.dumps(data), encoding='utf-8')
                source = ['--load-info-json', str(cached)]
                self.emit({'type': 'progress', 'update': {'status': 'Подключаемся к видеосерверу YouTube…'}})
            try:
                self.run(command + ['--format', selector, '--merge-output-format', 'mp4', '--remux-video', 'mp4',
                                '--output', template, '--no-simulate', '--no-quiet', '--newline', '--progress', '--progress-delta', '0.3',
                                '--concurrent-fragments', '4',
                                '--progress-template', progress_template, '--progress-template', 'postprocess:FRAME_POST:%(progress.status)s',
                                '--print', 'after_move:FRAME_FILE:%(filepath)j', *source], progress, idle_timeout=120)
            except HostError:
                # A failed cached URL must be extracted again on retry.
                self.cache_path(url).unlink(missing_ok=True)
                raise
            if self.canceled.is_set():
                raise HostError('Загрузка отменена.', 'CANCELED')
            if not completed_file or not completed_file.is_file() or completed_file.resolve().parent != Path(temporary).resolve():
                raise HostError('yt-dlp не сообщил путь готового видео.')
            # An existing destination is only replaced after the native save dialog.
            if message.get('saveAs') and sys.platform == 'darwin':
                os.replace(completed_file, destination)
            else:
                # Atomic creation avoids overwriting a simultaneous download.
                while True:
                    try:
                        if sys.platform == 'win32':
                            # Windows rename fails if a target exists, including on
                            # filesystems that do not support hard links.
                            os.rename(completed_file, destination)
                        else:
                            os.link(completed_file, destination)
                        break
                    except FileExistsError:
                        destination = self.choose_destination(destination.name, False)
            file_id = self.remember(destination)
            return {'nativeFileId': file_id, 'bytes': destination.stat().st_size, 'filename': destination.name}

    def handle(self, message):
        try:
            self.language = 'ru' if message.get('language') == 'ru' else 'en'
            action = message.get('action')
            if action == 'ping':
                programs = dependencies(self.config)
                result = {'version': '0.1.0', 'ytdlpVersion': self.run([programs['yt-dlp'], '--version'], idle_timeout=10).strip()}
            elif action == 'info':
                result = self.info(message)
            elif action == 'download':
                result = self.download(message)
            elif action == 'open':
                file_id = message.get('fileId')
                with registry_lock(), (ROOT / 'downloads.json').open(encoding='utf-8') as file:
                    entries = json.load(file)
                path = Path(entries.get(file_id, ''))
                if not path.is_file() or path.suffix.lower() != '.mp4':
                    raise HostError('Сохранённый файл не найден.')
                if sys.platform == 'darwin':
                    self.run(['/usr/bin/open', '-R', str(path)])
                elif sys.platform == 'win32':
                    self.run(['explorer.exe', '/select,', str(path)])
                else:
                    self.run(['xdg-open', str(path.parent)])
                result = {'ok': True}
            else:
                raise HostError('Неизвестная команда.', 'INVALID_REQUEST')
            self.emit({'type': 'result', 'result': result})
        except Exception as error:
            code = error.code if isinstance(error, HostError) else 'HELPER_ERROR'
            self.emit({'type': 'error', 'code': code, 'message': str(error)[:1000]})


def main():
    if sys.platform == 'win32':
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    config = json.loads((ROOT / 'config.json').read_text(encoding='utf-8'))
    if len(sys.argv) < 2 or sys.argv[1] not in config.get('allowedOrigins', []):
        return 1
    host = Host(config)
    try:
        while True:
            header = read_exact(sys.stdin.buffer, 4)
            if not header:
                break
            length = struct.unpack('<I', header)[0]
            if not 0 < length <= 65536:
                break
            data = read_exact(sys.stdin.buffer, length)
            if data is None:
                break
            message = json.loads(data)
            if message.get('action') == 'cancel':
                host.cancel()
            elif host.thread and host.thread.is_alive():
                send({'type': 'error', 'code': 'BUSY', 'message': 'frame-helper занят.'})
            else:
                host.canceled.clear()
                host.thread = threading.Thread(target=host.handle, args=(message,), daemon=True)
                host.thread.start()
    finally:
        host.cancel()
        if host.thread:
            host.thread.join(timeout=4)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
