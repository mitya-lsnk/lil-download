import { useEffect, useRef, useState } from "react";

import { api, type CookieStatus } from "../lib/api";
import { useStrings } from "../lib/i18n";
import { Icon } from "./Icon";

/** yt-dlp's own browser names, in the order most people will look for them. */
export const BROWSERS = [
  "firefox",
  "safari",
  "chrome",
  "brave",
  "edge",
  "opera",
  "vivaldi",
  "chromium",
] as const;

const DISMISS_KEY = "lildownload.cookieNoteDismissed";

/**
 * Where to borrow a logged-in session from.
 *
 * Nothing is read until a browser is picked, and even then the cookies never
 * pass through this app — the browser name goes to yt-dlp, which reads them
 * itself. A downloader has no business holding anyone's session tokens.
 *
 * Each browser is checked before it's offered, because the three ways this
 * fails need three different answers: a browser that isn't installed shouldn't
 * be selectable at all, one the OS won't let us read needs a permission the app
 * cannot grant itself, and the Chromium family will make macOS put up its own
 * Keychain prompt at download time.
 */
export function CookiePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (b: string | null) => void;
}) {
  const s = useStrings();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Record<string, CookieStatus>>({});
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === "1",
  );
  const ref = useRef<HTMLDivElement>(null);

  // Checking is a couple of stat calls, so it happens when the menu opens
  // rather than at startup — no reason to touch anyone's Library uninvited.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    Promise.all(BROWSERS.map((b) => api.cookieAccess(b).catch(() => null))).then((all) => {
      if (!alive) return;
      const next: Record<string, CookieStatus> = {};
      all.forEach((st) => st && (next[st.browser] = st));
      setStatus(next);
    });
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function away(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const chosen = value ? status[value] : undefined;
  const needsGrant = chosen?.verdict === "full_disk";
  const keychain = chosen?.verdict === "keychain" && !dismissed;

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Storage can be unavailable; the note simply comes back next time.
    }
  }

  return (
    <div className="ck" ref={ref}>
      <button
        className={`b-btn ck-btn ${value ? "on" : ""} ${needsGrant ? "warn" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={value ? `${s.cookies.using} ${value}` : s.cookies.title}
      >
        <Icon name="cookie" />
        {/* No label. The name of a browser next to a cookie is a word doing
            the icon's job twice, and it changed the button's width every time
            the choice changed. Which browser it is shows in the menu, in the
            tooltip, and in the button being lit at all. */}
      </button>

      {open && (
        <div className="ck-menu b-panel" role="listbox">
          <span className="ck-head b-cap">{s.cookies.title}</span>
          <p className="ck-why">{s.cookies.why}</p>

          <button
            className={`ck-item ${!value ? "on" : ""}`}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            {s.cookies.off}
          </button>

          {BROWSERS.map((b) => {
            const st = status[b];
            const missing = st?.verdict === "not_installed";
            return (
              <button
                key={b}
                role="option"
                aria-selected={value === b}
                className={`ck-item ${value === b ? "on" : ""} ${missing ? "off" : ""}`}
                disabled={missing}
                onClick={() => {
                  onChange(b);
                  setOpen(false);
                }}
              >
                <span>{b}</span>
                <span className="ck-state">
                  {!st && s.cookies.checking}
                  {missing && s.cookies.notInstalled}
                  {st?.verdict === "full_disk" && s.cookies.needsAccess}
                  {st?.verdict === "ok" && <Icon name="ok" size={13} />}
                </span>
              </button>
            );
          })}

          {needsGrant && (
            <div className="ck-inline">
              <span>{s.cookies.grantHow}</span>
              <button
                className="b-btn"
                onMouseDown={() => api.openPrivacySettings().catch(() => {})}
              >
                {s.cookies.grant}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Only while the menu is shut. Both are anchored to the same button, so
          leaving it up drew the notice straight across the browser list. */}
      {!open && needsGrant && (
        <div className="ck-alert">
          <span>{s.cookies.grantHow}</span>
          <button className="b-btn" onClick={() => api.openPrivacySettings().catch(() => {})}>
            {s.cookies.grant}
          </button>
        </div>
      )}
      {!open && keychain && (
        <div className="ck-alert quiet">
          <span>{s.cookies.keychainNote}</span>
          <button className="ck-dismiss" onClick={dismiss}>
            {s.cookies.dismiss}
          </button>
        </div>
      )}
    </div>
  );
}
