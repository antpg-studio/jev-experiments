import type { Note } from "./model.ts";

export const SEED_NOTES: Note[] = [
  {
    id: "n1",
    title: "Launch checklist",
    pinned: true,
    text: `# Launch checklist

The palette demo ships when every item below is green. Keep this note short and *ruthlessly* practical.

## Before the demo

- [x] Seed three realistic notes
- [x] Wire every command to a visible effect
- [ ] Run the benchmark twice and record the numbers
- [ ] Record a 20 second GIF of the palette re-ranking live

## Talking points

1. Fuzzy matching needs the command **name**; people type the **effect**.
2. A chat model understands the effect but takes a couple of seconds.
3. Jev answers in about 150 ms, so we can re-rank on every keystroke pause.

> "The best interface is the one you never have to learn." — someone on a slide, probably

Try it: press Ctrl+K and type \`make this louder\`.
`,
  },
  {
    id: "n2",
    title: "Meeting notes 2026-09-16",
    pinned: false,
    text: `# Meeting notes — 2026-09-16

Attendees: Priya, Tomas, Lena, Kwame

## Decisions

- Keep the sidebar collapsible; default open on wide screens
- Sepia theme stays (Lena's request)
- Export to PDF uses the browser print dialog for now

## Open questions

- Should low-confidence results require a click?
- How many argument slots can we speculatively ask for before the request gets slow?
- banana
- apple
- cherry
- apple

## Action items

- [ ] Tomas: measure p95 under load
- [ ] Priya: write the README table
- [ ] Kwame: design the confirmation prompt for destructive commands
`,
  },
  {
    id: "n3",
    title: "Reading list",
    pinned: false,
    text: `# Reading list

Books and papers queued for the autumn.

| Title | Author | Status |
| --- | --- | --- |
| The Design of Everyday Things | Don Norman | reading |
| Thinking, Fast and Slow | Daniel Kahneman | queued |
| Site Reliability Engineering | Beyer et al. | done |

## Papers

- "Attention Is All You Need" — re-read section 3
- "The UNIX Time-Sharing System" — for the philosophy chapter

---

Notes to self: the palette should feel like search-as-you-type, not like a form.
`,
  },
];
