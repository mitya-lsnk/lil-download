import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { DICTS, type Dict } from "./strings";

export type Lang = "ru" | "en";

const STORAGE_KEY = "lildownload.lang";

function isLang(v: unknown): v is Lang {
  return v === "ru" || v === "en";
}

// No stored choice → follow the OS locale (Russian UI → ru, everything else en),
// mirroring how the light/dark mode follows prefers-color-scheme. Once the user
// picks a language we persist it and stop tracking the system setting.
function readInitial(): Lang {
  if (typeof localStorage !== "undefined") {
    const v = localStorage.getItem(STORAGE_KEY);
    if (isLang(v)) return v;
  }
  if (typeof navigator !== "undefined") {
    const langs = navigator.languages ?? [navigator.language];
    if (langs.some((l) => l?.toLowerCase().startsWith("ru"))) return "ru";
  }
  return "en";
}

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** The active language's string dictionary. */
  s: Dict;
}

const Ctx = createContext<LangCtx>({
  lang: "en",
  setLang: () => {},
  s: DICTS.en,
});

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(readInitial);

  // Reflect the choice on <html lang> (correct hyphenation/spellcheck) and persist.
  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // storage may be unavailable (private mode); the attribute still applies.
    }
  }, [lang]);

  return (
    <Ctx.Provider value={{ lang, setLang, s: DICTS[lang] }}>
      {children}
    </Ctx.Provider>
  );
}

/** Full context — language plus setter. */
export function useLang(): LangCtx {
  return useContext(Ctx);
}

/** Just the active dictionary, for components that only render text. */
export function useStrings(): Dict {
  return useContext(Ctx).s;
}
