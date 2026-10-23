// lil download — кнопка на панели браузера (PLAN.md §13, этап 3).
//
// Нажал — адрес открытой страницы уходит в lil download. Что это, видео или
// файл, решает сама программа: она спросит сервер. Код общий для всех
// браузеров; отличается только то, кто на той стороне принимает сообщение:
// в Сафари — расширение внутри помощника «lil download Safari», в Хроме и
// Файрфоксе потом будет маленькая программа-посредник с тем же именем.

const api = globalThis.browser ?? globalThis.chrome;

// Сафари имя не смотрит и отдаёт сообщение своему приложению; Хрому и
// Файрфоксу по нему искать посредника.
const HOST = "com.lil.download";

async function send(items) {
  const r = await api.runtime.sendNativeMessage(HOST, { action: "send", items });
  if (!r || r.error) throw new Error(r?.error || "lil download не ответил");
}

// Ответ на нажатие — значок на кнопке на пару секунд и подсказка при наведении.
function flash(tabId, ok, title) {
  api.action.setBadgeText({ tabId, text: ok ? "✓" : "!" });
  api.action.setBadgeBackgroundColor?.({ tabId, color: ok ? "#2e7d32" : "#c62828" });
  api.action.setTitle({ tabId, title });
  setTimeout(() => {
    api.action.setBadgeText({ tabId, text: "" });
    api.action.setTitle({ tabId, title: "Скачать в lil download" });
  }, ok ? 2500 : 6000);
}

api.action.onClicked.addListener(async (tab) => {
  const url = tab?.url;
  if (!url || !/^https?:\/\//.test(url)) {
    flash(tab?.id, false, "Эту страницу не скачать: это не сайт или Сафари не дал её адрес");
    return;
  }
  try {
    await send([{ url, referer: null, kind: null }]);
    flash(tab.id, true, "Отправлено в lil download");
  } catch (e) {
    flash(tab.id, false, String(e?.message ?? e));
  }
});
