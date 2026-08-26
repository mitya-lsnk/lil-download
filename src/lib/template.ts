/**
 * The filename template, as pieces rather than as a string.
 *
 * yt-dlp's own form — `%(title)s — %(uploader)s.%(ext)s` — is fine to *read*
 * and miserable to *edit*: one missing bracket and the field silently becomes
 * literal text in the filename. Parsing it into tokens lets the UI offer whole
 * fields to drag around, and guarantees the string it produces is well-formed.
 */

export type Token = { kind: "field"; name: string } | { kind: "text"; value: string };

const FIELD = /%\(([^)]+)\)s/g;

export function parseTemplate(t: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  for (const m of t.matchAll(FIELD)) {
    let text = m.index! > last ? t.slice(last, m.index) : "";
    // A field that carries its own leading character takes it back out of the
    // text in front of it, so `%(title)s.%(ext)s` reads as two chips and not as
    // two chips with a stray dot wedged between them.
    const lead = ALL.get(m[1])?.emit?.[0];
    if (lead && lead !== "%" && text.endsWith(lead)) text = text.slice(0, -1);
    if (text) out.push({ kind: "text", value: text });
    out.push({ kind: "field", name: m[1] });
    last = m.index! + m[0].length;
  }
  if (last < t.length) out.push({ kind: "text", value: t.slice(last) });
  return out;
}

/**
 * Back to a yt-dlp template.
 *
 * Nothing is inserted between pieces here. The extension needs a dot in front
 * of it — without one the name runs together, `Как настроить светmp4` — but
 * that dot belongs to the extension itself (`emit: ".%(ext)s"`), not to the
 * code that joins pieces. Patching it in at join time meant the same dot had
 * to be added in the preview too, and skipped when a dot was already there,
 * and the chip claimed to be something it wasn't.
 */
export function serialize(tokens: Token[]): string {
  return tokens.map((t) => (t.kind === "text" ? t.value : emitOf(t.name))).join("");
}

/** The exact yt-dlp text a field stands for. */
export function emitOf(name: string): string {
  return ALL.get(name)?.emit ?? `%(${name})s`;
}

/**
 * Is the extension somewhere other than the end?
 *
 * yt-dlp will happily produce `video.mp4Title` — a file the system can't open,
 * from a template that looked fine. The chip is draggable, so this is easy to
 * do by accident and impossible to spot without being told.
 */
export function extNotLast(tokens: Token[]): boolean {
  const i = tokens.findIndex((t) => t.kind === "field" && t.name === "ext");
  return i !== -1 && i !== tokens.length - 1;
}

export interface FieldDef {
  name: string;
  label: string;
  /** Sample value, for the preview when nothing has been probed yet. */
  sample: string;
  /**
   * The yt-dlp text this chip stands for, when it isn't simply `%(name)s`.
   * Only the extension needs it so far, and it needs it for a real reason: the
   * dot is part of what "extension" means in a filename.
   */
  emit?: string;
}

export interface FieldGroup {
  id:
    | "required"
    | "main"
    | "channel"
    | "dates"
    | "meta"
    | "playlist"
    | "chapter"
    | "episode"
    | "track"
    | "section"
    | "sep";
  items: FieldDef[];
}

/**
 * `ext` is in a group of its own because leaving it out is not a matter of
 * taste: the file lands with no extension, and nothing on the machine knows
 * how to open it.
 *
 * The rest follows yt-dlp's own output-template fields, grouped so the list is
 * searchable rather than exhaustive-and-useless. Separators are the exception:
 * they insert literal text, not a field, but they are what people reach for
 * between two fields and hunting for the "+" to type a dash is silly.
 */
export const GROUPS: FieldGroup[] = [
  {
    id: "required",
    items: [{ name: "ext", label: "Расширение", sample: ".mp4", emit: ".%(ext)s" }],
  },
  {
    id: "main",
    items: [
      { name: "title", label: "Название", sample: "Как настроить свет" },
      { name: "fulltitle", label: "Полное название", sample: "Как настроить свет" },
      { name: "id", label: "Идентификатор", sample: "b9xTDEDjf7s" },
      { name: "display_id", label: "Показываемый ID", sample: "b9xTDEDjf7s" },
      { name: "alt_title", label: "Второе название", sample: "Lighting 101" },
      { name: "duration", label: "Длительность, секунд", sample: "469" },
      { name: "duration_string", label: "Длительность", sample: "7:49" },
      { name: "resolution", label: "Разрешение", sample: "1920x1080" },
      { name: "width", label: "Ширина", sample: "1920" },
      { name: "height", label: "Высота", sample: "1080" },
      { name: "fps", label: "Кадры в секунду", sample: "30" },
      { name: "format_note", label: "Пометка качества", sample: "1080p" },
      { name: "format_id", label: "Номер формата", sample: "137" },
      { name: "vcodec", label: "Кодек видео", sample: "avc1" },
      { name: "acodec", label: "Кодек звука", sample: "mp4a" },
      { name: "abr", label: "Битрейт звука", sample: "128" },
      { name: "vbr", label: "Битрейт видео", sample: "2400" },
      { name: "filesize_approx", label: "Примерный размер", sample: "78000000" },
      { name: "language", label: "Язык", sample: "ru" },
    ],
  },
  {
    id: "channel",
    items: [
      { name: "uploader", label: "Автор", sample: "Akascape" },
      { name: "uploader_id", label: "Ссылка автора", sample: "@akascape" },
      { name: "uploader_url", label: "Адрес автора", sample: "youtube.com/@akascape" },
      { name: "channel", label: "Канал", sample: "Akascape" },
      { name: "channel_id", label: "ID канала", sample: "UCabc123" },
      { name: "channel_url", label: "Адрес канала", sample: "youtube.com/channel/UCabc123" },
      { name: "channel_follower_count", label: "Подписчиков", sample: "84200" },
      { name: "creator", label: "Создатель", sample: "Akascape" },
      { name: "artist", label: "Исполнитель", sample: "Boards of Canada" },
      { name: "album_artist", label: "Исполнитель альбома", sample: "Boards of Canada" },
    ],
  },
  {
    id: "dates",
    items: [
      { name: "upload_date", label: "Дата загрузки", sample: "20260819" },
      { name: "release_date", label: "Дата выхода", sample: "20260818" },
      { name: "modified_date", label: "Дата изменения", sample: "20260820" },
      { name: "release_year", label: "Год выхода", sample: "2026" },
      { name: "timestamp", label: "Метка времени", sample: "1787200000" },
      { name: "epoch", label: "Время скачивания", sample: "1787214000" },
    ],
  },
  {
    id: "meta",
    items: [
      { name: "extractor", label: "Извлекатель", sample: "youtube" },
      { name: "extractor_key", label: "Источник", sample: "Youtube" },
      { name: "webpage_url", label: "Адрес страницы", sample: "youtube.com/watch?v=b9xTDEDjf7s" },
      { name: "webpage_url_domain", label: "Домен", sample: "youtube.com" },
      { name: "webpage_url_basename", label: "Имя страницы", sample: "watch" },
      { name: "original_url", label: "Исходная ссылка", sample: "youtu.be/b9xTDEDjf7s" },
      { name: "view_count", label: "Просмотры", sample: "128400" },
      { name: "like_count", label: "Лайки", sample: "9100" },
      { name: "comment_count", label: "Комментарии", sample: "412" },
      { name: "repost_count", label: "Репосты", sample: "58" },
      { name: "age_limit", label: "Возрастное ограничение", sample: "0" },
      { name: "live_status", label: "Статус эфира", sample: "not_live" },
      { name: "availability", label: "Доступность", sample: "public" },
      { name: "categories", label: "Категории", sample: "Education" },
      { name: "tags", label: "Теги", sample: "lighting" },
      { name: "license", label: "Лицензия", sample: "Standard" },
      { name: "location", label: "Место", sample: "Berlin" },
      { name: "autonumber", label: "Автономер", sample: "00001" },
    ],
  },
  {
    id: "playlist",
    items: [
      { name: "playlist_title", label: "Название плейлиста", sample: "Уроки света" },
      { name: "playlist_id", label: "ID плейлиста", sample: "PL999" },
      { name: "playlist_index", label: "Номер в плейлисте", sample: "03" },
      { name: "playlist_count", label: "Всего в плейлисте", sample: "24" },
      { name: "playlist_autonumber", label: "Автономер в плейлисте", sample: "03" },
      { name: "playlist_uploader", label: "Автор плейлиста", sample: "Akascape" },
      { name: "playlist_channel", label: "Канал плейлиста", sample: "Akascape" },
      { name: "n_entries", label: "Всего записей", sample: "24" },
    ],
  },
  {
    id: "chapter",
    items: [
      { name: "chapter", label: "Глава", sample: "Введение" },
      { name: "chapter_number", label: "Номер главы", sample: "2" },
      { name: "chapter_id", label: "ID главы", sample: "ch2" },
    ],
  },
  {
    id: "episode",
    items: [
      { name: "series", label: "Сериал", sample: "Свет и тень" },
      { name: "season", label: "Сезон", sample: "Сезон 1" },
      { name: "season_number", label: "Номер сезона", sample: "1" },
      { name: "episode", label: "Серия", sample: "Мягкий свет" },
      { name: "episode_number", label: "Номер серии", sample: "4" },
    ],
  },
  {
    id: "track",
    items: [
      { name: "track", label: "Трек", sample: "Roygbiv" },
      { name: "track_number", label: "Номер трека", sample: "7" },
      { name: "album", label: "Альбом", sample: "Music Has the Right" },
      { name: "genre", label: "Жанр", sample: "Electronic" },
      { name: "disc_number", label: "Номер диска", sample: "1" },
    ],
  },
  {
    id: "section",
    items: [
      { name: "section_title", label: "Название отрезка", sample: "Часть 2" },
      { name: "section_number", label: "Номер отрезка", sample: "2" },
      { name: "section_start", label: "Начало отрезка", sample: "150" },
      { name: "section_end", label: "Конец отрезка", sample: "300" },
    ],
  },
];

/** Literal text worth one click instead of typing it into a box. */
export const SEPARATORS: { label: string; value: string }[] = [
  { label: "тире", value: " — " },
  { label: "дефис", value: "-" },
  { label: "подчёркивание", value: "_" },
  { label: "точка", value: "." },
  { label: "пробел", value: " " },
  { label: "косая", value: "/" },
  { label: "[", value: " [" },
  { label: "]", value: "]" },
  { label: "(", value: " (" },
  { label: ")", value: ")" },
];

const ALL = new Map(GROUPS.flatMap((g) => g.items.map((f) => [f.name, f])));

export function fieldLabel(name: string): string {
  return ALL.get(name)?.label ?? name;
}

export function groupOf(name: string): FieldGroup["id"] {
  return GROUPS.find((g) => g.items.some((f) => f.name === name))?.id ?? "meta";
}

/**
 * Every filename needs an extension; the rest is preference.
 *
 * Checked against the serialised string rather than the chips, because
 * `%(ext)s` typed by hand into a text piece is just as valid as a chip — and
 * demanding a chip anyway is a warning the user cannot act on truthfully.
 */
export function missingExt(tokens: Token[]): boolean {
  return !serialize(tokens).includes("%(ext)");
}

/** What the template would produce, from real values where we have them. */
export function preview(tokens: Token[], real: Record<string, string> = {}): string {
  return tokens
    .map((t) => {
      if (t.kind === "text") return t.value;
      const v = real[t.name];
      // A probed value arrives bare; the sample already carries whatever the
      // field's own emit adds in front of it.
      if (v !== undefined) return t.name === "ext" ? `.${v}` : v;
      return ALL.get(t.name)?.sample ?? t.name;
    })
    .join("");
}
