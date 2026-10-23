# Кнопка lil download в браузере

PLAN.md §13, этап 3. Кнопка на панели браузера отправляет открытую страницу в
lil download через «почтовый ящик» (`src-tauri/src/inbox.rs`).

- `extension/` — само расширение, общее для всех браузеров. Сообщение уходит
  через `runtime.sendNativeMessage("com.lil.download", {action: "send", items})`.
- `safari/` — помощник «lil download Safari»: Xcode-проект (сделан
  `safari-web-extension-converter`, файлы расширения берёт из `extension/`, не
  копирует). Его `SafariWebExtensionHandler` кладёт JSON в
  `~/Library/Application Support/com.lil.download/inbox/` и стучит ссылкой
  `lildownload://inbox`. Сборка и установка в `~/Applications` — `safari/build.sh`.
  Новый файл в `extension/` нужно вписать в проект Xcode — `build.sh` это проверяет.
- Без платного аккаунта Apple помощник подписан Personal Team и работает только
  на своём Маке; в GitHub-сборку lil download он не входит.

Потом: Хром и Файрфокс — тот же `extension/` и маленький посредник
(native messaging host) с именем `com.lil.download`, который делает то же, что
обработчик Сафари.
