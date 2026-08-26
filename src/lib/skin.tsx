import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Skin = "brutal" | "riso" | "te" | "studio";
export type Mode = "light" | "dark";

export interface SkinMeta {
  id: Skin;
  /** two swatch colors for the picker chip */
  swatch: [string, string];
}

// Names are localized — see the `skins` block in strings.tsx, keyed by id.
// Here we only keep what doesn't translate: the id and the swatch colors.
// studio is the default — listed first, and the fallback when nothing is stored.
export const SKINS: SkinMeta[] = [
  { id: "studio", swatch: ["#ff3d0d", "#2fbf4c"] },
  { id: "brutal", swatch: ["#ffde00", "#111111"] },
  { id: "riso", swatch: ["#ea3a0c", "#2233c4"] },
  { id: "te", swatch: ["#fa4b00", "#15150f"] },
];

const STORAGE_KEY = "lildownload.skin";
const MODE_KEY = "lildownload.mode";

function isSkin(v: unknown): v is Skin {
  return v === "brutal" || v === "riso" || v === "te" || v === "studio";
}
function isMode(v: unknown): v is Mode {
  return v === "light" || v === "dark";
}

function readInitial(): Skin {
  if (typeof localStorage !== "undefined") {
    const v = localStorage.getItem(STORAGE_KEY);
    if (isSkin(v)) return v;
  }
  return "studio";
}

// No stored choice → follow the OS. Once the user toggles, we persist and stop
// tracking the system preference (an explicit choice wins).
function readInitialMode(): Mode {
  if (typeof localStorage !== "undefined") {
    const v = localStorage.getItem(MODE_KEY);
    if (isMode(v)) return v;
  }
  if (
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

interface SkinCtx {
  skin: Skin;
  setSkin: (s: Skin) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  toggleMode: () => void;
}

const Ctx = createContext<SkinCtx>({
  skin: "studio",
  setSkin: () => {},
  mode: "light",
  setMode: () => {},
  toggleMode: () => {},
});

export function SkinProvider({ children }: { children: ReactNode }) {
  const [skin, setSkin] = useState<Skin>(readInitial);
  const [mode, setMode] = useState<Mode>(readInitialMode);

  // Reflect the choice on <html data-skin> so CSS can key off it, and persist.
  useEffect(() => {
    document.documentElement.dataset.skin = skin;
    try {
      localStorage.setItem(STORAGE_KEY, skin);
    } catch {
      // storage may be unavailable (private mode); the data-attr still applies.
    }
  }, [skin]);

  // Light/dark is an orthogonal axis: CSS combines [data-mode] with [data-skin].
  useEffect(() => {
    document.documentElement.dataset.mode = mode;
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      // ignore — the data-attr still applies for this session.
    }
  }, [mode]);

  const toggleMode = () => setMode((m) => (m === "dark" ? "light" : "dark"));

  return (
    <Ctx.Provider value={{ skin, setSkin, mode, setMode, toggleMode }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSkin(): SkinCtx {
  return useContext(Ctx);
}
