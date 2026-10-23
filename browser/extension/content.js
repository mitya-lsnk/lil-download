// lil download — помощник на странице для пункта в меню правой кнопки.
//
// Сафари сам говорит расширению, по чему щёлкнули, только если это видно
// сверху: ссылка, картинка, видео. А на многих сайтах поверх фотографии лежит
// прозрачный слой с подписью — Сафари видит слой и считает, что щёлкнули по
// пустому месту. Поэтому здесь запоминается всё, что лежит под указателем, в
// том числе под слоями. Никуда это не уходит, пока не выбран пункт
// «Скачать в lil download»: тогда фоновый скрипт спрашивает, что было под
// щелчком, и отправляет это в lil download.

(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  let last = null;

  const web = (u) => typeof u === "string" && /^https?:\/\//.test(u);
  const abs = (u) => {
    try {
      return new URL(u, document.baseURI).href;
    } catch {
      return null;
    }
  };

  // Из srcset — самый крупный вариант: сайт обычно показывает уменьшенный, а
  // в списке лежит и полный размер.
  function biggest(img) {
    let best = img.currentSrc || img.src;
    let bestW = 0;
    for (const part of (img.srcset || "").split(",")) {
      const [u, d] = part.trim().split(/\s+/);
      const w = parseFloat(d) * (d?.endsWith("x") ? 1000 : 1);
      if (u && w > bestW) {
        bestW = w;
        best = u;
      }
    }
    return abs(best);
  }

  function background(el) {
    const m = /url\(["']?([^"')]+)["']?\)/.exec(getComputedStyle(el).backgroundImage || "");
    return m ? abs(m[1]) : null;
  }

  function look(x, y) {
    const found = { image: null, video: null };
    for (const el of document.elementsFromPoint(x, y)) {
      if (!found.image && el instanceof HTMLImageElement) {
        const u = biggest(el);
        if (web(u)) found.image = u;
      } else if (!found.video && el instanceof HTMLVideoElement) {
        // Пустой адрес обернулся бы адресом самой страницы.
        const raw = el.currentSrc || el.src || el.querySelector("source")?.src;
        const u = raw ? abs(raw) : null;
        if (web(u)) found.video = u;
      } else if (!found.image && el !== document.documentElement && el !== document.body) {
        const u = background(el);
        if (web(u)) found.image = u;
      }
      if (found.image && found.video) break;
    }
    return found;
  }

  document.addEventListener(
    "contextmenu",
    (e) => {
      last = { ...look(e.clientX, e.clientY), at: Date.now() };
    },
    true,
  );

  api.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.q !== "lil-download:target") return;
    // Отвечает только та рамка страницы, где был щелчок, и только свежий.
    if (!last || Date.now() - last.at > 15000 || (!last.image && !last.video)) return;
    reply({ image: last.image, video: last.video });
    return true;
  });
})();
