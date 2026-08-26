import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { useStrings } from "../lib/i18n";
import { hasTauri } from "../lib/tauri";
import {
  autoCheckEnabled,
  checkUpdate,
  safeReleaseUrl,
  setAutoCheck,
  type UpdateInfo,
} from "../lib/update";
import { Icon } from "./Icon";

/**
 * "Is there a newer one?" — asked on demand, and optionally on launch.
 *
 * Nothing is installed from here. Both apps ship unsigned, so an in-place
 * updater would be replacing a binary nobody verified with another binary
 * nobody verified; the honest version hands over a link and lets the system's
 * own checks happen.
 *
 * The launch check has an off switch because it is the only connection the app
 * makes on its own. Off means the app opens no connection unless asked.
 */
export function UpdatePanel({ version }: { version: string }) {
  const s = useStrings();
  const [auto, setAuto] = useState(autoCheckEnabled);
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // The launch check, when it's on. Quiet about failures: someone offline does
  // not need to be told so by a settings screen they opened for another reason.
  useEffect(() => {
    if (!auto || !hasTauri()) return;
    let alive = true;
    checkUpdate()
      .then((u) => alive && setInfo(u))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run() {
    setBusy(true);
    setFailed(false);
    try {
      setInfo(await checkUpdate());
    } catch {
      // Told out loud here, because this time the user asked.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const link = safeReleaseUrl(info?.asset) ?? safeReleaseUrl(info?.url);

  return (
    <div className="upd">
      <div className="upd-row">
        <span className="b-mono upd-ver">
          {s.appUpdate.current} {version}
        </span>
        <button className="b-btn" onClick={run} disabled={busy || !hasTauri()}>
          <Icon name={busy ? "busy" : "refresh"} className={busy ? "spin" : ""} size={14} />{" "}
          {busy ? s.appUpdate.checking : s.appUpdate.check}
        </button>
      </div>

      {failed && <p className="upd-note">{s.appUpdate.failed}</p>}
      {!failed && info && !info.available && <p className="upd-note">{s.appUpdate.upToDate}</p>}

      {!failed && info?.available && (
        <div className="upd-card">
          <span className="upd-head b-mono">{s.appUpdate.available(info.latest)}</span>
          {info.notes && (
            <details className="upd-notes">
              <summary>{s.appUpdate.notes}</summary>
              <pre>{info.notes}</pre>
            </details>
          )}
          {link && (
            <button className="b-btn b-btn--solid" onClick={() => openUrl(link)}>
              <Icon name="download" size={14} /> {s.appUpdate.download}
            </button>
          )}
        </div>
      )}

      <label className="upd-auto">
        <input
          type="checkbox"
          checked={auto}
          onChange={(e) => {
            setAuto(e.target.checked);
            setAutoCheck(e.target.checked);
          }}
        />
        <span>{s.appUpdate.auto}</span>
      </label>
      <p className="upd-note">{s.appUpdate.autoNote}</p>
    </div>
  );
}
