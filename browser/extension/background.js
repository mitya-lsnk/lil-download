// lil download — кнопка на панели браузера (PLAN.md §13, этап 3).
//
// Нажал — адрес открытой страницы уходит в lil download. Что это, видео или
// файл, решает сама программа: она спросит сервер. Код общий для всех
// браузеров; отличается только то, кто на той стороне принимает сообщение:
// в Сафари — расширение внутри помощника «lil download Safari», в Хроме и
// Файрфоксе потом будет маленькая программа-посредник с тем же именем.

const api = globalThis.browser ?? globalThis.chrome;

// Подписи на кнопке. Записаны кодами символов, а не буквами: Сафари читает
// фоновый скрипт расширения не как UTF-8, и русский текст на кнопке
// превращался в «Ð¡ÐºÐ°Ñ‡...». Читаемый вариант — в комментарии справа.
const T = {
  title: "\u0421\u043a\u0430\u0447\u0430\u0442\u044c \u0432 lil download", // Скачать в lil download
  sent: "\u041e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e \u0432 lil download", // Отправлено в lil download
  notWeb: "\u042d\u0442\u0443 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0443 \u043d\u0435 \u0441\u043a\u0430\u0447\u0430\u0442\u044c: \u044d\u0442\u043e \u043d\u0435 \u0441\u0430\u0439\u0442 \u0438\u043b\u0438 \u0421\u0430\u0444\u0430\u0440\u0438 \u043d\u0435 \u0434\u0430\u043b \u0435\u0451 \u0430\u0434\u0440\u0435\u0441", // Эту страницу не скачать: это не сайт или Сафари не дал её адрес
  noAnswer: "lil download \u043d\u0435 \u043e\u0442\u0432\u0435\u0442\u0438\u043b", // lil download не ответил
};

// Сафари имя не смотрит и отдаёт сообщение своему приложению; Хрому и
// Файрфоксу по нему искать посредника.
const HOST = "com.lil.download";

async function send(items) {
  const r = await api.runtime.sendNativeMessage(HOST, { action: "send", items });
  if (!r || r.error) throw new Error(r?.error || T.noAnswer);
}

// Ответ на нажатие — значок на кнопке на пару секунд и подсказка при наведении.
function flash(tabId, ok, title) {
  api.action.setBadgeText({ tabId, text: ok ? "✓" : "!" });
  api.action.setBadgeBackgroundColor?.({ tabId, color: ok ? "#2e7d32" : "#c62828" });
  api.action.setTitle({ tabId, title });
  setTimeout(() => {
    api.action.setBadgeText({ tabId, text: "" });
    api.action.setTitle({ tabId, title: T.title });
  }, ok ? 2500 : 6000);
}

api.action.onClicked.addListener(async (tab) => {
  const url = tab?.url;
  if (!url || !/^https?:\/\//.test(url)) {
    flash(tab?.id, false, T.notWeb);
    return;
  }
  try {
    await send([{ url, referer: null, kind: null }]);
    flash(tab.id, true, T.sent);
  } catch (e) {
    flash(tab.id, false, String(e?.message ?? e));
  }
});
