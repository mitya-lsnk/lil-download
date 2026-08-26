import { useMemo, useRef } from "react";

import { useStrings } from "../lib/i18n";
import { useCloseOnBlur } from "../lib/useCloseOnBlur";

type Group = "net" | "files" | "meta" | "pick" | "subs" | "live" | "audio" | "access" | "misc";

interface Flag {
  /** The flag itself. */
  f: string;
  /** What it does, in one line. */
  what: string;
  /** Does it need a value after it? */
  v?: true;
  g: Group;
}

/**
 * The yt-dlp options worth suggesting.
 *
 * Not all ~400 — a list nobody can read is the same as no list — but every
 * option people reach for often enough to remember it exists. The five that
 * used to be here covered almost nothing.
 *
 * `v` matters beyond documentation: a flag that needs a value and doesn't get
 * one takes the next argument as its value, which is how the app's own ffmpeg
 * path once ended up being treated as the URL to download.
 */
const FLAGS: Flag[] = [
  // сеть и скорость
  { f: "--limit-rate", what: "ограничить скорость, например 2M", v: true, g: "net" },
  { f: "--retries", what: "сколько раз повторять при обрыве", v: true, g: "net" },
  { f: "--fragment-retries", what: "повторы для отдельных кусков", v: true, g: "net" },
  { f: "--concurrent-fragments", what: "качать куски в N потоков, например 4", v: true, g: "net" },
  { f: "--throttled-rate", what: "ниже какой скорости пересоединяться", v: true, g: "net" },
  { f: "--socket-timeout", what: "таймаут соединения, секунд", v: true, g: "net" },
  { f: "--proxy", what: "прокси, например socks5://127.0.0.1:1080", v: true, g: "net" },
  { f: "--source-address", what: "с какого сетевого адреса качать", v: true, g: "net" },
  { f: "--force-ipv4", what: "только IPv4", g: "net" },
  { f: "--force-ipv6", what: "только IPv6", g: "net" },
  { f: "--sleep-requests", what: "пауза между запросами, секунд", v: true, g: "net" },
  { f: "--sleep-interval", what: "пауза перед каждым файлом, секунд", v: true, g: "net" },
  { f: "--max-sleep-interval", what: "верхняя граница случайной паузы", v: true, g: "net" },
  { f: "--no-check-certificates", what: "не проверять сертификат сайта", g: "net" },
  { f: "--downloader", what: "качать через aria2c, ffmpeg и т.п.", v: true, g: "net" },
  { f: "--downloader-args", what: "аргументы для этого загрузчика", v: true, g: "net" },

  // файлы на диске
  { f: "--no-part", what: "писать сразу в итоговый файл", g: "files" },
  { f: "--no-mtime", what: "не ставить дату файла из видео", g: "files" },
  { f: "--no-overwrites", what: "не трогать уже скачанное", g: "files" },
  { f: "--force-overwrites", what: "перезаписывать без вопросов", g: "files" },
  { f: "--continue", what: "докачивать оборванное", g: "files" },
  { f: "--no-continue", what: "начинать файл заново", g: "files" },
  { f: "--write-thumbnail", what: "сохранить обложку отдельным файлом", g: "files" },
  { f: "--write-all-thumbnails", what: "сохранить все размеры обложки", g: "files" },
  { f: "--write-description", what: "сохранить описание в .txt", g: "files" },
  { f: "--write-info-json", what: "сохранить все метаданные в .json", g: "files" },
  { f: "--write-link", what: "положить рядом ярлык на страницу", g: "files" },
  { f: "--trim-filenames", what: "обрезать имя до N символов", v: true, g: "files" },
  { f: "--restrict-filenames", what: "только латиница и цифры в имени", g: "files" },
  { f: "--windows-filenames", what: "имя, безопасное для Windows", g: "files" },
  { f: "--paths", what: "куда класть, например temp:/tmp", v: true, g: "files" },
  { f: "--batch-file", what: "файл со списком ссылок", v: true, g: "files" },
  { f: "--download-archive", what: "файл со списком уже скачанного", v: true, g: "files" },
  { f: "--cache-dir", what: "где держать кэш", v: true, g: "files" },
  { f: "--rm-cache-dir", what: "снести кэш перед скачиванием", g: "files" },

  // метаданные внутри файла
  { f: "--embed-metadata", what: "записать метаданные внутрь файла", g: "meta" },
  { f: "--embed-chapters", what: "записать главы внутрь файла", g: "meta" },
  { f: "--embed-info-json", what: "вшить весь json метаданных", g: "meta" },
  { f: "--parse-metadata", what: "разобрать поле по образцу", v: true, g: "meta" },
  { f: "--replace-in-metadata", what: "заменить текст в поле", v: true, g: "meta" },
  { f: "--xattrs", what: "метаданные в атрибуты файла", g: "meta" },

  // что именно брать
  { f: "--playlist-items", what: "какие номера из плейлиста, например 1-5", v: true, g: "pick" },
  { f: "--max-downloads", what: "остановиться после N файлов", v: true, g: "pick" },
  { f: "--match-filter", what: "условие отбора, например duration<600", v: true, g: "pick" },
  { f: "--break-on-existing", what: "стоп, как встретится уже скачанное", g: "pick" },
  { f: "--min-filesize", what: "пропускать мельче, например 10M", v: true, g: "pick" },
  { f: "--max-filesize", what: "пропускать крупнее, например 2G", v: true, g: "pick" },
  { f: "--date", what: "только за эту дату, ГГГГММДД", v: true, g: "pick" },
  { f: "--dateafter", what: "только новее этой даты", v: true, g: "pick" },
  { f: "--datebefore", what: "только старше этой даты", v: true, g: "pick" },
  { f: "--format-sort", what: "чем сортировать качества, например res,fps", v: true, g: "pick" },
  { f: "--merge-output-format", what: "в какой контейнер склеивать", v: true, g: "pick" },
  { f: "--extractor-args", what: "настройки конкретного сайта", v: true, g: "pick" },

  // субтитры
  { f: "--write-subs", what: "скачать субтитры автора", g: "subs" },
  { f: "--write-auto-subs", what: "скачать автоматические субтитры", g: "subs" },
  { f: "--sub-langs", what: "языки субтитров, например ru,en", v: true, g: "subs" },
  { f: "--sub-format", what: "какой формат просить, например srt/best", v: true, g: "subs" },
  { f: "--convert-subs", what: "перевести субтитры в srt/ass/vtt", v: true, g: "subs" },
  { f: "--embed-subs", what: "вшить субтитры в контейнер", g: "subs" },

  // эфиры
  { f: "--live-from-start", what: "качать эфир с самого начала", g: "live" },
  { f: "--wait-for-video", what: "ждать, если эфир ещё не начался", v: true, g: "live" },
  { f: "--hls-use-mpegts", what: "формат, переживающий обрыв эфира", g: "live" },

  // звук и перекодирование
  { f: "--extract-audio", what: "выкинуть картинку, оставить звук", g: "audio" },
  { f: "--audio-format", what: "формат звука, например mp3", v: true, g: "audio" },
  { f: "--audio-quality", what: "качество звука, 0 — лучшее", v: true, g: "audio" },
  { f: "--remux-video", what: "переложить в другой контейнер без потерь", v: true, g: "audio" },
  { f: "--recode-video", what: "перекодировать в другой формат", v: true, g: "audio" },
  { f: "--split-chapters", what: "разрезать по главам на отдельные файлы", g: "audio" },
  { f: "--postprocessor-args", what: "аргументы ffmpeg, например ffmpeg:-vf …", v: true, g: "audio" },

  // доступ
  { f: "--cookies", what: "путь к файлу cookies.txt", v: true, g: "access" },
  { f: "--cookies-from-browser", what: "браузер, откуда взять сессию", v: true, g: "access" },
  { f: "--geo-bypass", what: "попробовать обойти региональный запрет", g: "access" },
  { f: "--geo-bypass-country", what: "прикинуться страной, например DE", v: true, g: "access" },
  { f: "--referer", what: "каким адресом представиться", v: true, g: "access" },
  { f: "--user-agent", what: "каким браузером представиться", v: true, g: "access" },
  { f: "--add-headers", what: "свой заголовок, Ключ:значение", v: true, g: "access" },

  // прочее
  { f: "--sponsorblock-mark", what: "пометить главами, а не вырезать", v: true, g: "misc" },
  { f: "--sponsorblock-remove", what: "вырезать куски: sponsor,intro,outro", v: true, g: "misc" },
  { f: "--ignore-errors", what: "не останавливаться на ошибке", g: "misc" },
  { f: "--abort-on-error", what: "остановиться на первой ошибке", g: "misc" },
  { f: "--verbose", what: "подробный лог — для разбирательств", g: "misc" },
];

/**
 * A flags field that helps rather than just accepting text.
 *
 * Completion works on the word under the cursor, so a flag can be fixed in the
 * middle of a line without retyping the rest. With nothing typed the whole
 * catalogue is on offer, grouped — the point of a suggestion list is to answer
 * "what can I even put here", not only to finish a word already begun.
 */
export function FlagsInput({
  value,
  onChange,
  disabled,
  className = "",
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const s = useStrings();
  const { open, show, hideSoon, hideNow } = useCloseOnBlur();
  const ref = useRef<HTMLInputElement>(null);

  // The token being typed: everything after the last space.
  const token = useMemo(() => value.split(/\s+/).pop() ?? "", [value]);

  const hits = useMemo(() => {
    const t = token.trim().toLowerCase();
    if (!t) return FLAGS;
    // A leading dash means "finish this flag"; anything else is someone
    // searching by what they want to happen.
    if (t.startsWith("-")) return FLAGS.filter((x) => x.f.startsWith(t) && x.f !== t);
    return FLAGS.filter((x) => x.f.includes(t) || x.what.toLowerCase().includes(t));
  }, [token]);

  const groups = useMemo(() => {
    const order: Group[] = ["net", "files", "meta", "pick", "subs", "live", "audio", "access", "misc"];
    return order
      .map((g) => ({ id: g, items: hits.filter((x) => x.g === g) }))
      .filter((g) => g.items.length > 0);
  }, [hits]);

  /**
   * A flag that needs a value and hasn't been given one.
   *
   * Worth catching here because of what it does further down: yt-dlp takes the
   * *next* argument as the missing value, and the next argument is whatever the
   * app appended — which is how a download once died complaining that the app's
   * own ffmpeg folder "is not a valid URL". Nothing about that error points
   * back to this field.
   */
  const dangling = useMemo(() => {
    const words = value.trim().split(/\s+/).filter(Boolean);
    const last = words[words.length - 1];
    return FLAGS.find((x) => x.v && x.f === last)?.f ?? null;
  }, [value]);

  function complete(flag: string) {
    const parts = value.split(/(\s+)/);
    // Replace the trailing token, keeping whatever came before it intact.
    let replaced = false;
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i].trim()) {
        parts[i] = flag;
        replaced = true;
        break;
      }
    }
    onChange(`${replaced ? parts.join("") : flag} `);
    hideNow();
    ref.current?.focus();
  }

  return (
    <div className="fl">
      <input
        ref={ref}
        className={`fl-input b-mono ${className}`}
        value={value}
        disabled={disabled}
        placeholder={placeholder ?? "--no-mtime --write-subs"}
        spellCheck={false}
        onChange={(e) => {
          onChange(e.target.value);
          show();
        }}
        onFocus={show}
        onBlur={hideSoon}
        onKeyDown={(e) => {
          if (e.key === "Tab" && hits.length > 0) {
            e.preventDefault();
            complete(hits[0].f);
          }
          if (e.key === "Escape") hideNow();
        }}
      />
      {dangling && !disabled && (
        <span className="fl-warn b-mono">
          {dangling} {s.opts.flagsDangling}
        </span>
      )}
      {open && groups.length > 0 && !disabled && (
        <div className="fl-menu b-panel">
          {groups.map((g) => (
            <div key={g.id} className="fl-group">
              <span className="b-cap fl-group-name">{s.opts.flagGroups[g.id]}</span>
              {g.items.map((x) => (
                <button key={x.f} className="fl-item" onMouseDown={() => complete(x.f)}>
                  <span className="fl-flag b-mono">
                    {x.f}
                    {x.v && <span className="fl-needs"> ⟨…⟩</span>}
                  </span>
                  <span className="fl-what">{x.what}</span>
                </button>
              ))}
            </div>
          ))}
          <span className="fl-tab b-mono">{s.opts.flagsTab}</span>
        </div>
      )}
    </div>
  );
}
