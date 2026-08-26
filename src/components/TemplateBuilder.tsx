import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { useStrings } from "../lib/i18n";
import { useCloseOnBlur } from "../lib/useCloseOnBlur";
import {
  GROUPS,
  SEPARATORS,
  fieldLabel,
  groupOf,
  emitOf,
  extNotLast,
  missingExt,
  parseTemplate,
  preview,
  serialize,
  type Token,
} from "../lib/template";
import { Icon } from "./Icon";

/**
 * The filename, built from pieces — or typed out, for those who'd rather.
 *
 * Three things the visual mode earns over a text field. Fields are whole
 * objects, so a bracket can't go missing. The extension is checked, because
 * leaving it out produces a file the system cannot open and nothing else would
 * say so. And there's a live preview, so the shape of the name is visible
 * before it's applied to a hundred files.
 *
 * The manual mode exists because the catalogue can't cover everything yt-dlp
 * accepts — field modifiers like `%(title).80s` or `%(upload_date>%Y)s` have no
 * chip and shouldn't be unreachable.
 *
 * `real` lets a caller feed in values from a link that's on screen; Settings
 * has none, so it falls back to the samples in the catalogue.
 */
export function TemplateBuilder({
  value,
  onChange,
  real,
}: {
  value: string;
  onChange: (v: string) => void;
  real?: Record<string, string>;
}) {
  const s = useStrings();
  const [query, setQuery] = useState("");
  const { open, show, hideSoon } = useCloseOnBlur();
  const [manual, setManual] = useState(false);

  const tokens = useMemo(() => parseTemplate(value), [value]);
  const commit = (next: Token[]) => onChange(serialize(next));

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GROUPS.map((g) => ({
      id: g.id,
      // Matches the human label *and* the yt-dlp name, so both "канал" and
      // "channel" find the same chips.
      items: g.items.filter(
        (f) => !q || f.label.toLowerCase().includes(q) || f.name.includes(q),
      ),
    })).filter((g) => g.items.length > 0);
  }, [query]);

  const addField = (name: string) => {
    commit([...tokens, { kind: "field", name }]);
    setQuery("");
  };
  const addText = (v = " ") => commit([...tokens, { kind: "text", value: v }]);
  const removeAt = (i: number) => commit(tokens.filter((_, n) => n !== i));

  /**
   * Text pieces are re-parsed as they're typed, so `%(ext)s` typed by hand
   * becomes a chip instead of sitting there as literal text that silently ends
   * up in the filename.
   */
  function editText(i: number, v: string) {
    const next = tokens.map((t, n) => (n === i && t.kind === "text" ? { ...t, value: v } : t));
    onChange(serialize(next));
  }

  // ---------------------------------------------------------------- dragging
  //
  // Pointer events rather than HTML5 drag-and-drop, which never once worked
  // here. Two separate reasons, either of which is fatal on its own: the
  // webview's own file-drop handler eats dragstart before the page sees it,
  // and WebKit won't begin a drag on an element that holds a text input.
  // Pointer capture has neither problem and works the same on a trackpad.

  const nodes = useRef<(HTMLElement | null)[]>([]);
  const dragRef = useRef<{ from: number; to: number } | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);

  /** Which gap the pointer is nearest — 0..tokens.length, a gap not an item. */
  function gapAt(x: number, y: number): number {
    let gap = tokens.length;
    let best = Infinity;
    // Sliced, because the ref array keeps its length when pieces are removed
    // and a stale node would still win the distance test.
    nodes.current.slice(0, tokens.length).forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      // The strip wraps, so a chip one row down must not win on horizontal
      // closeness alone. Weighting the vertical distance keeps the answer on
      // the row the pointer is actually over.
      const d = Math.abs(x - cx) + Math.abs(y - cy) * 4;
      if (d < best) {
        best = d;
        gap = x > cx ? i + 1 : i;
      }
    });
    return gap;
  }

  function grab(e: ReactPointerEvent, i: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { from: i, to: i };
    setDrag({ from: i, to: i });
  }

  function trail(e: ReactPointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const to = gapAt(e.clientX, e.clientY);
    if (to !== d.to) {
      dragRef.current = { ...d, to };
      setDrag({ ...d, to });
    }
  }

  function release() {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    move(d.from, d.to > d.from ? d.to - 1 : d.to);
  }

  function move(from: number, to: number) {
    if (to === from || to < 0 || to >= tokens.length) return;
    const next = [...tokens];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    commit(next);
  }

  /** The same reordering from the keyboard, for anyone not using a mouse. */
  function nudge(e: React.KeyboardEvent, i: number) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      move(i, i - 1);
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      move(i, i + 1);
    }
  }

  const grip = (i: number) => (
    <span
      className="tb-grip"
      role="button"
      tabIndex={0}
      aria-label={s.tpl.move}
      title={s.tpl.move}
      onPointerDown={(e) => grab(e, i)}
      onPointerMove={trail}
      onPointerUp={release}
      onPointerCancel={release}
      onKeyDown={(e) => nudge(e, i)}
    >
      ⣿
    </span>
  );

  return (
    <div className="tb">
      <div className="tb-modes">
        <button
          className={`b-btn ${manual ? "" : "on"}`}
          onClick={() => setManual(false)}
        >
          {s.tpl.visual}
        </button>
        <button className={`b-btn ${manual ? "on" : ""}`} onClick={() => setManual(true)}>
          <Icon name="code" size={14} /> {s.tpl.manual}
        </button>
      </div>

      {manual ? (
        <>
          <input
            className="tb-raw b-mono"
            value={value}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
          />
          <span className="settings-hint">{s.tpl.manualHint}</span>
        </>
      ) : (
        <>
          <div className={`tb-strip ${drag ? "dragging" : ""}`}>
            {tokens.map((t, i) => (
              <span key={i} className="tb-slot">
                {drag?.to === i && <span className="tb-caret" />}
                {t.kind === "field" ? (
                  <span
                    ref={(el) => {
                      nodes.current[i] = el;
                    }}
                    className={`tb-chip g-${groupOf(t.name)} ${drag?.from === i ? "lifted" : ""}`}
                    title={emitOf(t.name)}
                  >
                    {grip(i)}
                    {fieldLabel(t.name)}
                    <button className="tb-x" onClick={() => removeAt(i)} aria-label={s.tpl.remove}>
                      <Icon name="close" size={11} />
                    </button>
                  </span>
                ) : (
                  // Wrapped, so a text piece has its own remove button. Emptying
                  // the box used to leave an inert field nothing could delete.
                  <span
                    ref={(el) => {
                      nodes.current[i] = el;
                    }}
                    className={`tb-textwrap ${drag?.from === i ? "lifted" : ""}`}
                  >
                    {grip(i)}
                    <input
                      className="tb-text b-mono"
                      value={t.value}
                      spellCheck={false}
                      style={{ width: `${Math.max(2, t.value.length + 1)}ch` }}
                      onChange={(e) => editText(i, e.target.value)}
                    />
                    <button className="tb-x" onClick={() => removeAt(i)} aria-label={s.tpl.remove}>
                      <Icon name="close" size={11} />
                    </button>
                  </span>
                )}
              </span>
            ))}
            {drag?.to === tokens.length && <span className="tb-caret" />}
            <button className="tb-add" onClick={() => addText()} title={s.tpl.addText}>
              +
            </button>
          </div>

          <div className="tb-search">
            <input
              className="tb-query b-mono"
              value={query}
              placeholder={s.tpl.search}
              spellCheck={false}
              onChange={(e) => {
                setQuery(e.target.value);
                show();
              }}
              onFocus={show}
              onBlur={hideSoon}
            />
            {open && (
              <div className="tb-menu b-panel">
                {!query.trim() && (
                  <div className="tb-group">
                    <span className="b-cap tb-group-name">{s.tpl.groups.sep}</span>
                    <div className="tb-group-items">
                      {SEPARATORS.map((sep) => (
                        <button
                          key={sep.label}
                          className="tb-chip g-sep tb-pick"
                          onMouseDown={() => addText(sep.value)}
                        >
                          {sep.label}
                          <span className="tb-code b-mono">{`"${sep.value}"`}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {hits.map((g) => (
                  <div key={g.id} className="tb-group">
                    <span className="b-cap tb-group-name">{s.tpl.groups[g.id]}</span>
                    <div className="tb-group-items">
                      {g.items.map((f) => (
                        <button
                          key={f.name}
                          className={`tb-chip g-${g.id} tb-pick`}
                          onMouseDown={() => addField(f.name)}
                        >
                          {f.label}
                          <span className="tb-code b-mono">{emitOf(f.name)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {extNotLast(tokens) && !missingExt(tokens) && (
        <div className="tb-warn">
          <span>{s.tpl.extLast}</span>
        </div>
      )}

      {missingExt(tokens) && (
        <div className="tb-warn">
          <span>{s.tpl.needExt}</span>
          <button className="b-btn" onClick={() => addField("ext")}>
            {s.tpl.addExt}
          </button>
        </div>
      )}

      <div className="tb-preview b-mono">
        <span className="tb-preview-label">{s.tpl.preview}</span>
        <span className="tb-preview-value">{preview(tokens, real)}</span>
      </div>
    </div>
  );
}
