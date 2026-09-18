import type { MinuteItem } from "../lib/aggregate.ts";
import type { Bucket } from "../lib/resolve.ts";
import type { Attendee } from "../lib/types.ts";
import type { Row } from "../lib/useMeeting.ts";
import { ItemCard } from "./ItemCard.tsx";
import { Pane, type PaneIdx } from "./Pane.tsx";

const ORDER: { bucket: Bucket; pane: PaneIdx }[] = [
  { bucket: "actions", pane: 1 },
  { bucket: "decisions", pane: 2 },
  { bucket: "questions", pane: 3 },
  { bucket: "risks", pane: 4 },
];

interface Props {
  items: MinuteItem[];
  rows: Row[];
  attendees: Attendee[];
  onShown: (id: number, ms: number) => void;
  onFix: (id: number, name: string | null) => void;
  active: PaneIdx;
  onActivate: (i: PaneIdx) => void;
}

export function Lists({ items, rows, attendees, onShown, onFix, active, onActivate }: Props) {
  const spokenAt = new Map(rows.map((r) => [r.id, r.spokenAt]));
  return (
    <section className="lists">
      {ORDER.map(({ bucket: b, pane }) => {
        const list = items.filter((x) => x.bucket === b);
        return (
          <Pane key={b} idx={pane} className={`list ${b}`} active={active} onActivate={onActivate} right={<span className="count">{list.length}</span>}>
            <div className="scroll">
              {list.length === 0 && <p className="empty">Nothing yet</p>}
              {list.map((x) => (
                <ItemCard
                  key={x.id}
                  item={x}
                  spokenAt={spokenAt.get(x.utteranceId) ?? performance.now()}
                  attendees={attendees}
                  onShown={onShown}
                  onFix={onFix}
                />
              ))}
            </div>
          </Pane>
        );
      })}
    </section>
  );
}
