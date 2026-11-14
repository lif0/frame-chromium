# Подключение браузера на macOS к Codex на другой машине

Chrome работает на Mac, а Codex и Chrome DevTools MCP — на соседней машине. SSH-туннель позволяет MCP обращаться к браузеру через локальный порт. Основной вариант — подключение с Mac к машине с Codex.

## Что потребуется

- Google Chrome на Mac.
- SSH-доступ с Mac к машине с Codex.
- Codex CLI, Node.js LTS и npm на машине с Codex.
- Свободный порт `9222` на обеих машинах.

В командах `USER@CODEX_IP` обозначает пользователя и адрес машины с Codex. Подставь свои значения.

## 1. Запустить Chrome на Mac

В Terminal на Mac выполни:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/Library/Application Support/Chrome-Video-Debug"
```

Откроется Chrome с отдельным профилем. Открой в нём нужный сайт и при необходимости войди в аккаунт. Данные этого профиля сохраняются между запусками.

Для Chromium или другого браузера путь к приложению будет другим. Chrome DevTools MCP официально поддерживает Google Chrome и Chrome for Testing.

В другой вкладке Terminal проверь доступность отладки на Mac:

```bash
curl --fail --max-time 5 http://127.0.0.1:9222/json/version
```

Ожидается JSON с полями `Browser` и `webSocketDebuggerUrl`.

## 2. Создать обратный туннель с Mac

В отдельной вкладке Terminal на Mac выполни:

```bash
ssh -NT \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -R 127.0.0.1:9222:127.0.0.1:9222 \
  USER@CODEX_IP
```

После SSH-аутентификации команда обычно работает без вывода. Оставь эту вкладку открытой.

Туннель направляет обращения к `127.0.0.1:9222` на машине с Codex в `127.0.0.1:9222` на Mac. Включать SSH-сервер на Mac для этого варианта не требуется. SSH-сервер на машине с Codex должен разрешать перенаправление портов.

На машине с Codex проверь соединение:

```bash
curl --fail --max-time 5 http://127.0.0.1:9222/json/version
```

Должен вернуться JSON браузера, запущенного на Mac.

## 3. Подключить MCP на машине с Codex

Один раз зарегистрируй сервер:

```bash
codex mcp add chrome-devtools -- \
  npx -y chrome-devtools-mcp@latest \
  --browser-url=http://127.0.0.1:9222
```

Проверь сохранённую конфигурацию:

```bash
codex mcp list
```

`--browser-url` — аргумент MCP-сервера. Его не нужно добавлять к команде возобновления Codex.

## 4. Продолжить текущую сессию Codex CLI

В текущей сессии введи `/quit`. Затем из той же папки проекта запусти:

```bash
codex resume --last
```

Если открывал несколько сессий, выбери нужную вручную:

```bash
codex resume
```

После возобновления напиши: «Проверь подключение к браузеру».

Chrome и SSH-туннель на Mac должны оставаться запущенными. Эти команды возобновления относятся к терминальному Codex CLI.

## Альтернатива — туннель с машины Codex на Mac

Используй этот вариант вместо шага 2, если SSH-доступ уже настроен в обратную сторону. На Mac должен быть включён «Удалённый вход» и разрешён доступ нужному пользователю.

На машине с Codex выполни, заменив `MAC_USER@MAC_IP`:

```bash
ssh -NT \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -L 127.0.0.1:9222:127.0.0.1:9222 \
  MAC_USER@MAC_IP
```

Остальные шаги и адрес MCP остаются прежними. Одновременно запускать оба варианта туннеля не нужно.

## Если соединение не работает

- `Connection refused` при проверке на Mac: проверь, что запущен Chrome с указанными параметрами и отдельным профилем.
- Проверка на Mac успешна, а на машине с Codex — нет: проверь, что SSH-туннель работает и сервер разрешает перенаправление портов.
- `remote port forwarding failed` или `Address already in use`: порт на машине с Codex занят. Проверь, не остался ли прежний туннель. Можно использовать на стороне Codex порт `9223`: для `-R` или `-L` укажи `127.0.0.1:9223:127.0.0.1:9222`, а в проверке и `--browser-url` используй `9223`.
- `Permission denied` от SSH: проверь пользователя, адрес и настройку SSH-ключа.
- MCP не появляется: проверь `codex mcp list`, доступность `node` и `npx`, затем возобнови сессию.
- После сна Mac или разрыва сети: повторно запусти команду туннеля и проверь адрес `/json/version`.

## Завершение работы

Нажми `Ctrl+C` в терминале с SSH-туннелем и закрой отдельное окно Chrome. Конфигурация MCP и профиль Chrome сохранятся; при следующем запуске достаточно снова открыть Chrome и создать туннель.

Порт отладки даёт управление браузером. Используй отдельный профиль и локальную привязку `127.0.0.1`, как в командах выше.

## Документация

- [Подключение Chrome DevTools MCP к запущенному браузеру](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md#manual-connection-using-port-forwarding)
- [Требование отдельного профиля Chrome для порта отладки](https://developer.chrome.com/blog/remote-debugging-port)
- [Настройка MCP в Codex](https://developers.openai.com/codex/mcp/)
- [Справочник команд Codex CLI](https://developers.openai.com/codex/cli/reference/)
