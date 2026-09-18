import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Store } from "./lib/store.ts";
import { Grid, normalize, type Editing, type Selection } from "./ui/Grid.tsx";
import { StatusBar } from "./ui/StatusBar.tsx";
import { colToName } from "./engine/refs.ts";
import { viewOf } from "./ui/format.ts";
import { isJev } from "./engine/values.ts";

const store = new Store();
store.fetchHealth();
store.tick();
Object.assign(window, { judgeSheets: store });

const HELP = [
  ["=JUDGE(text, \"yes/no question\")", "probability 0–100 % (noul) · heat cell"],
  ["=PICK(text, \"instructions\", \"a|b|c\")", "one option (choice) · tint = confidence"],
  ["=RATE(text, \"instructions\", \"lvl0|lvl1|lvl2\")", "ordinal score (score) · red→green"],
  ["SUM AVERAGE COUNT COUNTIF SUMIF IF AND OR NOT LEN UPPER LOWER TRIM CONCAT ROUND ABS", ""],
];

export default function App() {
  const version = useSyncExternalStore(store.subscribe, store.getVersion);
  const [sheet, setSheet] = useState("Reviews");
  const [sel, setSel] = useState<Selection>({ ar: 1, ac: 3, fr: 1, fc: 3 });
  const [editing, setEditing] = useState<Editing>(null);
  const [bar, setBar] = useState<{ sheet: string; row: number; col: number; text: string } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [now, setNow] = useState(performance.now());
  const barRef = useRef<HTMLInputElement>(null);

  const sheets = [...store.wb.sheets.keys()];
  const sh = store.wb.getSheet(sheet);
  const raw = store.wb.getRaw(sheet, sel.ar, sel.ac);
  const value = store.wb.getValue(sheet, sel.ar, sel.ac);
  const view = viewOf(value);

  // live clock while a run is active
  const active = store.runner.run.active;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [active]);
  useEffect(() => setNow(performance.now()), [version]);

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 3500);
    return () => clearTimeout(id);
  }, [flash]);

  const move = useCallback(
    (dr: number, dc: number, extend = false) => {
      const r = Math.max(0, Math.min(sh.rows - 1, (extend ? sel.fr : sel.ar) + dr));
      const c = Math.max(0, Math.min(sh.cols - 1, (extend ? sel.fc : sel.ac) + dc));
      setSel(extend ? { ...sel, fr: r, fc: c } : { ar: r, ac: c, fr: r, fc: c });
    },
    [sel, sh.rows, sh.cols],
  );

  const commitEdit = useCallback(
    (text: string, dir: "down" | "right" | "none") => {
      if (!editing) return;
      store.setCell(sheet, editing.row, editing.col, text);
      setEditing(null);
      setBar(null);
      if (dir === "down") move(1, 0);
      else if (dir === "right") move(0, 1);
    },
    [editing, sheet, move],
  );
  const cancelEdit = useCallback(() => {
    setEditing(null);
    setBar(null);
  }, []);

  const fillColumn = useCallback(() => {
    const n = normalize(sel);
    // fill down to the last row of the sheet's data (column A is the id column in both seeded sheets)
    const last = Math.max(store.lastUsedRowIn(sheet, 0), n.r2);
    let total = 0;
    let cols = 0;
    for (let c = n.c1; c <= n.c2; c++) {
      if (!store.wb.getRaw(sheet, n.r1, c)) continue;
      total += store.fillDown(sheet, n.r1, c, last);
      cols++;
    }
    setSel({ ar: n.r1, ac: n.c1, fr: n.r1, fc: n.c2 });
    setFlash(
      `Filled ${cols} column${cols === 1 ? "" : "s"} down to row ${last + 1} — ${total} cells changed${total ? ", re-judging…" : ""}`,
    );
  }, [sel, sheet]);

  const fillSelection = useCallback(() => {
    const n = normalize(sel);
    if (n.r2 === n.r1) return;
    let total = 0;
    for (let c = n.c1; c <= n.c2; c++) total += store.fillDown(sheet, n.r1, c, n.r2);
    setFlash(`Filled ${total} cells`);
  }, [sel, sheet]);

  const onFill = useCallback(
    (toRow: number) => {
      const n = normalize(sel);
      let total = 0;
      for (let c = n.c1; c <= n.c2; c++) total += store.fillDown(sheet, n.r1, c, toRow);
      setSel({ ar: n.r1, ac: n.c1, fr: toRow, fc: n.c2 });
      setFlash(`Filled ${total} cells${total ? " — re-judging…" : ""}`);
    },
    [sel, sheet],
  );

  const rejudge = useCallback(() => {
    const n = store.jevCellCount(sheet);
    store.rejudgeSheet(sheet);
    setFlash(`Dropped the cache for ${n} Jev cells on ${sheet} — re-judging everything…`);
  }, [sheet]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (editing) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (e.shiftKey) fillColumn();
        else fillSelection();
        return;
      }
      if (mod && e.key.toLowerCase() === "c") {
        const text = store.wb.getRaw(sheet, sel.ar, sel.ac);
        void navigator.clipboard?.writeText(text);
        return;
      }
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          move(mod ? sh.rows : 1, 0, e.shiftKey);
          return;
        case "ArrowUp":
          e.preventDefault();
          move(mod ? -sh.rows : -1, 0, e.shiftKey);
          return;
        case "ArrowLeft":
          e.preventDefault();
          move(0, -1, e.shiftKey);
          return;
        case "ArrowRight":
        case "Tab":
          e.preventDefault();
          move(0, e.shiftKey && e.key === "Tab" ? -1 : 1, e.shiftKey && e.key !== "Tab");
          return;
        case "PageDown":
          e.preventDefault();
          move(20, 0, e.shiftKey);
          return;
        case "PageUp":
          e.preventDefault();
          move(-20, 0, e.shiftKey);
          return;
        case "Enter":
        case "F2":
          e.preventDefault();
          setEditing({ row: sel.ar, col: sel.ac, text: store.wb.getRaw(sheet, sel.ar, sel.ac), caretEnd: true });
          return;
        case "Delete":
        case "Backspace": {
          e.preventDefault();
          const n = normalize(sel);
          for (let r = n.r1; r <= n.r2; r++)
            for (let c = n.c1; c <= n.c2; c++) if (store.wb.getRaw(sheet, r, c)) store.setCell(sheet, r, c, "");
          return;
        }
        case "Escape":
          setSel({ ar: sel.ar, ac: sel.ac, fr: sel.ar, fc: sel.ac });
          return;
        default:
          if (e.key.length === 1 && !mod && !e.altKey) {
            e.preventDefault();
            setEditing({ row: sel.ar, col: sel.ac, text: e.key, caretEnd: true });
          }
      }
    },
    [editing, sel, sheet, sh.rows, move, fillColumn, fillSelection],
  );

  const barOwnsSel = bar !== null && bar.sheet === sheet && bar.row === sel.ar && bar.col === sel.ac;
  const barValue = editing ? editing.text : barOwnsSel ? bar.text : raw;
  const commitBar = useCallback(() => {
    if (!bar) return;
    if (bar.text !== store.wb.getRaw(bar.sheet, bar.row, bar.col)) store.setCell(bar.sheet, bar.row, bar.col, bar.text);
    setBar(null);
  }, [bar]);
  const cellName = `${colToName(sel.ac)}${sel.ar + 1}`;
  const n = normalize(sel);
  const rangeName = n.r1 === n.r2 && n.c1 === n.c2 ? cellName : `${colToName(n.c1)}${n.r1 + 1}:${colToName(n.c2)}${n.r2 + 1}`;

  const modeBadge = useMemo(() => {
    const h = store.health;
    if (h.mode === "live") return { cls: "live", text: `LIVE · ${h.model}` };
    if (h.mode === "mock") return { cls: "mock", text: "MOCK MODE — replayed answers, not Jev" };
    if (h.mode === "nokey") return { cls: "bad", text: "NO API KEY — set TYPESAFE_API_KEY" };
    return { cls: "bad", text: "PROXY OFFLINE — run npm run dev" };
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">▦</span> Judge Sheets
          <span className="tag">spreadsheets that think, at spreadsheet speed</span>
        </div>
        <nav className="tabs">
          {sheets.map((s) => (
            <button
              key={s}
              className={`tab${s === sheet ? " on" : ""}`}
              onClick={() => {
                setSheet(s);
                setSel({ ar: 1, ac: s === "Leads" ? 4 : 3, fr: 1, fc: s === "Leads" ? 4 : 3 });
                setEditing(null);
              }}
            >
              {s}
            </button>
          ))}
        </nav>
        <div className="actions">
          <button className="btn" onClick={fillColumn} title="Copy the selected cell's formula down the whole column (Ctrl+Shift+D)">
            Fill column ↓ <kbd>Ctrl⇧D</kbd>
          </button>
          <button className="btn primary" onClick={rejudge} title="Drop the judgment cache for this sheet and re-ask Jev for every cell">
            Re-judge sheet ⟳
          </button>
          <span className={`mode ${modeBadge.cls}`}>{modeBadge.text}</span>
        </div>
      </header>

      <div className="formulabar">
        <div className="namebox">{rangeName}</div>
        <span className="fx">fx</span>
        <input
          ref={barRef}
          className="formulainput"
          value={barValue}
          spellCheck={false}
          onFocus={() => setBar({ sheet, row: sel.ar, col: sel.ac, text: raw })}
          onChange={(e) => {
            if (editing) setEditing({ ...editing, text: e.target.value });
            else setBar({ sheet, row: sel.ar, col: sel.ac, text: e.target.value });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (editing) commitEdit(editing.text, "down");
              else {
                if (bar) store.setCell(bar.sheet, bar.row, bar.col, bar.text);
                setBar(null);
                move(1, 0);
              }
              (e.target as HTMLInputElement).blur();
            } else if (e.key === "Escape") {
              cancelEdit();
              (e.target as HTMLInputElement).blur();
            }
          }}
          onBlur={() => {
            if (editing) return;
            commitBar();
          }}
        />
        <div className="cellinfo" title={view.title}>
          {isJev(value) ? (
            <>
              <span className={`pill ${value.jev}`}>{value.jev.toUpperCase()}</span>
              <span>{view.text}</span>
              <span className="dim">conf {Math.round(value.confidence * 100)}%</span>
              {value.probabilities && (
                <span className="dim probs">
                  {Object.entries(value.probabilities)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([k, p]) => `${value.levels && /^\d+$/.test(k) ? value.levels[Number(k)] : k} ${Math.round(p * 100)}%`)
                    .join(" · ")}
                </span>
              )}
            </>
          ) : (
            <span className="dim">{view.title ?? (raw.startsWith("=") ? view.text : "")}</span>
          )}
        </div>
      </div>

      <Grid
        store={store}
        sheet={sheet}
        sel={sel}
        setSel={setSel}
        editing={editing}
        setEditing={setEditing}
        commitEdit={commitEdit}
        cancelEdit={cancelEdit}
        onKeyDown={onKeyDown}
        onFill={onFill}
        version={version}
      />

      <div className="help">
        {HELP.map(([f, d]) => (
          <span key={f}>
            <code>{f}</code>
            {d && <span className="dim"> {d}</span>}
          </span>
        ))}
        {flash && <span className="flash">{flash}</span>}
      </div>

      <StatusBar
        run={store.runner.run}
        totals={store.runner.totals}
        now={now}
        lastError={store.runner.lastError}
        health={store.health}
      />
    </div>
  );
}
