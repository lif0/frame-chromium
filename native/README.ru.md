# frame-helper — скачивание YouTube

> Если Chrome запущен с отдельным каталогом `--user-data-dir` (например, для отладки через туннель), установите регистрацию и в него:
>
> ```bash
> bash native/install-macos.sh ID_РАСШИРЕНИЯ --user-data-dir "$HOME/Library/Application Support/Chrome-Video-Debug"
> ```
>
> Укажите свой путь из командной строки на `chrome://version`, без подпапки `Default` или `Profile 1`. В Linux используйте `native/install-linux.sh` с той же опцией. Обычные регистрации Chrome/Chromium сохраняются. В Windows регистрация выполняется через реестр, эта опция не нужна.

[English](README.md) · **Русский** · [Назад к Frame](../README.ru.md)

frame-helper работает локально и нужен **только для YouTube**. HLS и прямые видеофайлы скачиваются без него. Требуются Python 3, yt-dlp, FFmpeg и Deno.

Используйте ID со страницы **Установить frame-helper** или из `chrome://extensions`. Выполняйте команду в корне проекта — папке, содержащей `native`, а не внутри `dist`.

## macOS

Установите зависимости через [Homebrew](https://brew.sh/):

```bash
brew install python yt-dlp ffmpeg deno
bash native/install-macos.sh ID_РАСШИРЕНИЯ
```

frame-helper устанавливается в `~/Library/Application Support/Frame` и регистрируется в Google Chrome и Chromium для текущего пользователя, без `sudo`. При скачивании открывается системный диалог сохранения.

Обновление зависимостей: `brew upgrade yt-dlp ffmpeg deno`.

## Linux

Для Ubuntu / Debian:

```bash
sudo apt update
sudo apt install python3 pipx ffmpeg
pipx install 'yt-dlp[default]'
pipx ensurepath
```

Установите Deno по [официальной инструкции](https://docs.deno.com/runtime/getting_started/installation/). Для других дистрибутивов установите Python 3, pipx и FFmpeg своим пакетным менеджером, затем yt-dlp командой выше.

Откройте новый терминал в корне проекта:

```bash
bash native/install-linux.sh ID_РАСШИРЕНИЯ
```

frame-helper устанавливается в `~/.local/share/frame`. Регистрация записывается в `~/.config/google-chrome/NativeMessagingHosts` и `~/.config/chromium/NativeMessagingHosts`. Учитываются настройки `XDG_DATA_HOME` и `XDG_CONFIG_HOME`.

Нужна обычная установка Chrome или Chromium. Браузеры из Snap / Flatpak могут блокировать frame-helper. Файлы сохраняются в `~/Downloads`; если имя занято, выбирается свободное. Кнопка показа файла открывает папку через `xdg-open`.

Обновление yt-dlp: `pipx upgrade yt-dlp`. Обновляйте FFmpeg и Deno способом, которым они установлены.

## Windows

Установите зависимости в PowerShell через [WinGet](https://learn.microsoft.com/windows/package-manager/winget/):

```powershell
winget install --id Python.Python.3.13 -e
winget install --id yt-dlp.yt-dlp -e
winget install --id Gyan.FFmpeg -e
winget install --id DenoLand.Deno -e
```

Откройте **новое окно PowerShell** в корне проекта:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\native\install-windows.ps1 ID_РАСШИРЕНИЯ
```

`ExecutionPolicy Bypass` действует только для этого процесса PowerShell и не меняет постоянную политику компьютера. Сам установщик frame-helper не требует прав администратора.

frame-helper устанавливается в `%LOCALAPPDATA%\Frame`. Регистрация Native Messaging записывается в `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.frame.downloader` и аналогичный ключ Chromium. Python запускается локальным batch-файлом.

Видео сохраняются в `Downloads` вашего профиля со свободными именами. Кнопка показа выделяет файл в Проводнике. Если Chrome был открыт во время установки зависимостей, перезапустите его. Для обновления используйте `winget upgrade --id ИМЯ_ПАКЕТА -e` с ID пакетов выше.

Установщик и код для Windows добавлены, но проверка в настоящем браузере Windows ещё не проведена.

## Проверка подключения

Вернитесь на страницу настройки и нажмите **Проверить frame-helper**.

| Результат | Что означает и что делать |
| --- | --- |
| **frame-helper не найден.** | frame-helper не зарегистрирован. Запустите установщик для своей ОС с ID расширения. |
| **frame-helper не подключён к этому расширению…** | frame-helper зарегистрирован, но этот ID не разрешён. Повторите установку с текущим ID. |
| **Не установлены: …** | frame-helper найден, но не хватает перечисленных зависимостей. Установите их и повторите установку frame-helper. |
| **frame-helper не запустился или отключился…** | Регистрация есть, но процесс не запустился или завершился. Проверьте Python и повторите установку. |
| **frame-helper найден и готов к работе…** | frame-helper ответил и нашёл зависимости. Можно попробовать скачать видео. |

Успешная проверка не гарантирует, что YouTube даст доступ к конкретному ролику. frame-helper не читает cookie браузера. Требования входа, проверки «не робот», прямые эфиры и DRM не поддерживаются.

Для официального офлайн-просмотра рекомендуем [YouTube Premium](https://www.youtube.com/premium).

## Локальные данные

- `config.json` хранит разрешённые ID расширений, пути зависимостей и папку `downloadDir`. При переустановке существующие ID и выбранная папка сохраняются.
- `downloads.json` хранит до 100 путей готовых файлов для кнопки показа; `downloads.lock` координирует параллельные задания.
- Временные дорожки записываются рядом с итоговым файлом и удаляются при отмене или ошибке. На macOS существующий файл заменяется только после успешной загрузки и системного диалога сохранения. Linux и Windows не перезаписывают занятые имена.
- Команды запускаются массивами аргументов, без shell. Пользовательский конфиг yt-dlp игнорируется. Принимаются только ссылки на отдельные ролики YouTube.
- Пути зависимостей запоминаются при установке: Chrome не обязан наследовать PATH вашего терминала. После переноса зависимостей или обновления исходников frame-helper повторите установку.

Для удаления уберите регистрации своей ОС, указанные выше, и папку frame-helper. Скачанные видео хранятся отдельно и останутся на месте. Расширение продолжит скачивать HLS и прямые файлы.
