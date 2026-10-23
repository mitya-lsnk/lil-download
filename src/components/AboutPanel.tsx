// lil-kit: shared file — edit ~/lil-kit/web/src/components/AboutPanel.tsx, then run ~/lil-kit/sync.sh
import type { ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { useLang } from "../lib/i18n";
import { LIL } from "../lib/lilapp";

// Its own few words, so the panel needs nothing from an app's strings.tsx.
const T = {
  ru: { title: "О программе", version: "Версия", page: "Страница на GitHub" },
  en: { title: "About", version: "Version", page: "Project page on GitHub" },
};

/**
 * Settings → About, the last tab in every lil app: the name, the version, a few
 * words on what the app is for, then whatever the app adds below (the update
 * panel, where there is a release to check against), and who made it.
 *
 *   <AboutPanel about={s.settings.about}><UpdatePanel version={__APP_VERSION__} /></AboutPanel>
 */
export function AboutPanel({ about, children }: { about: ReactNode; children?: ReactNode }) {
  const { lang } = useLang();
  const t = T[lang];
  const page = LIL.repo ? `https://github.com/${LIL.repo}` : null;

  return (
    <section className="ap">
      <h2 className="ap-h">{t.title}</h2>
      <div className="about-id">
        <span className="about-name">{LIL.name}</span>
        <span className="about-ver">
          {t.version} {__APP_VERSION__}
        </span>
      </div>
      <div className="about-text">{about}</div>
      {children && <div className="about-block">{children}</div>}
      <div className="about-foot">
        <span className="about-by">lil software</span>
        {page && (
          <button className="b-btn" onClick={() => openUrl(page)}>
            {t.page}
          </button>
        )}
      </div>
    </section>
  );
}
