import { useRef, useState } from "react";
import { readText } from "@tauri-apps/plugin-clipboard-manager";

import { useStrings } from "../lib/i18n";
import { Icon } from "./Icon";

/**
 * The one input on the main screen.
 *
 * The clipboard is read **only when the button is pressed**. An earlier version
 * peeked on every window focus, which meant the app was quietly reading whatever
 * you'd copied — passwords included — without ever being asked. Convenience
 * isn't worth that; one click is not a hardship.
 */
export function LinkBar({
  value,
  onValue,
  onSubmit,
  busy,
  canQuick,
}: {
  value: string;
  onValue: (v: string) => void;
  /** `quick` skips the card and downloads with the remembered settings. */
  onSubmit: (url: string, quick: boolean) => void;
  busy: boolean;
  /** There is somewhere to put it, so the one-shot path is available. */
  canQuick: boolean;
}) {
  const s = useStrings();
  const [note, setNote] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  function submit(v: string, quick = false) {
    const t = v.trim();
    if (!t || busy) return;
    onSubmit(t, quick && canQuick);
  }

  async function fromClipboard() {
    setNote(null);
    try {
      const t = (await readText())?.trim();
      if (!t) {
        setNote(s.app.clipboardEmpty);
        return;
      }
      onValue(t);
      ref.current?.focus();
    } catch {
      setNote(s.app.clipboardDenied);
    }
  }

  return (
    <div className="linkbar">
      <div className="linkbar-row b-panel">
        <input
          ref={ref}
          className="linkbar-input b-mono"
          value={value}
          placeholder={s.app.dropHint}
          spellCheck={false}
          onChange={(e) => onValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            // ⌘↵ / Ctrl+↵ — straight to the last folder with the last
            // settings. The whole point is not having to look at the card.
            submit(value, e.metaKey || e.ctrlKey);
          }}
        />
        <button className="b-btn" onClick={fromClipboard} title={s.app.clipboardBtn}>
          <Icon name="paste" />
        </button>
        <button
          className="b-btn b-btn--yellow"
          disabled={busy || !value.trim()}
          title={canQuick ? s.app.quickHint : undefined}
          onClick={(e) => submit(value, e.metaKey || e.ctrlKey)}
        >
          <Icon name={busy ? "busy" : "download"} className={busy ? "spin" : ""} />{" "}
          {busy ? s.app.checking : s.card.download}
        </button>
      </div>
      {note && <span className="linkbar-note b-mono">{note}</span>}
      {canQuick && !note && <span className="linkbar-note b-mono">{s.app.quickHint}</span>}
    </div>
  );
}
