// lil-kit: shared file — edit ~/lil-kit/web/src/lib/menu.ts, then run ~/lil-kit/sync.sh
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { hasTauri } from "./tauri";
import { useSkin } from "./skin";

/**
 * The suite's native menu bar (src-tauri/src/menu.rs). Pass a handler for each
 * optional item the app supports; items without a handler are left out of the
 * menu, so it never offers something that does nothing. The light/dark item is
 * always there and handled here, through the shared skin provider.
 *
 *   useLilMenu(lang, { settings: () => setAux("settings"), updates: checkNow });
 *
 * Call it once, near the top of App, inside SkinProvider. `lang` is the app's UI
 * language; the menu is rebuilt in it whenever it changes.
 */
export interface MenuHandlers {
  open?: () => void;
  settings?: () => void;
  updates?: () => void;
}

export function useLilMenu(lang: "ru" | "en", handlers: MenuHandlers): void {
  const { toggleMode } = useSkin();
  // Latest closures without re-subscribing on every render.
  const live = useRef({ ...handlers, theme: toggleMode });
  live.current = { ...handlers, theme: toggleMode };

  const features = {
    open: !!handlers.open,
    settings: !!handlers.settings,
    updates: !!handlers.updates,
    theme: true,
  };
  const shape = JSON.stringify(features);

  useEffect(() => {
    if (!hasTauri()) return;
    invoke("lil_menu", { lang, features: JSON.parse(shape) }).catch(() => {
      // The menu is a convenience; the app works without it.
    });
  }, [lang, shape]);

  useEffect(() => {
    if (!hasTauri()) return;
    const off = listen<string>("lil-menu", (e) => {
      const id = e.payload as keyof typeof live.current;
      live.current[id]?.();
    });
    return () => {
      off.then((f) => f());
    };
  }, []);
}
