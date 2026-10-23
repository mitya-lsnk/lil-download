// lil-kit: shared file — edit ~/lil-kit/web/src/lib/i18n.tsx, then run ~/lil-kit/sync.sh
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { DICTS, type Dict } from "./strings";
import { LIL } from "./lilapp";

export type Lang = "ru" | "en";

const STORAGE_KEY = `${LIL.store}.lang`;

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

/**
 * `only` pins the language for an app that isn't translated yet (lil clean):
 * no locale detection, nothing stored, and setLang does nothing.
 */
export function LangProvider({ children, only }: { children: ReactNode; only?: Lang }) {
  const [chosen, setChosen] = useState<Lang>(() => only ?? readInitial());
  const lang = only ?? chosen;
  const setLang = only ? () => {} : setChosen;

  // Reflect the choice on <html lang> (correct hyphenation/spellcheck) and persist.
  useEffect(() => {
    document.documentElement.lang = lang;
    if (only) return;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // storage may be unavailable (private mode); the attribute still applies.
    }
  }, [lang, only]);

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
