import { useLang } from "../lib/i18n";

/** Compact RU/EN toggle for the header — mirrors the light/dark switch. */
export function LanguagePicker() {
  const { lang, setLang, s } = useLang();
  const next = lang === "ru" ? "en" : "ru";
  return (
    <button
      className="b-btn b-mono"
      onClick={() => setLang(next)}
      title={`${s.lang.label}: ${lang === "ru" ? s.lang.ru : s.lang.en}`}
      aria-label={`${s.lang.label} — ${lang === "ru" ? s.lang.en : s.lang.ru}`}
    >
      {lang.toUpperCase()}
    </button>
  );
}
