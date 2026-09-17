import type { DeadlineKind, MeetingContext } from "./types.ts";

export interface ResolvedDeadline {
  kind: DeadlineKind;
  /** ISO date or null when the kind implies a date that could not be parsed from the text */
  date: string | null;
  label: string;
}

const DAY_MS = 86_400_000;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const ORDINAL_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20, "twenty-first": 21, "twenty-second": 22, "twenty-third": 23,
  "twenty-fourth": 24, "twenty-fifth": 25, "twenty-sixth": 26, "twenty-seventh": 27, "twenty-eighth": 28,
  "twenty-ninth": 29, thirtieth: 30, "thirty-first": 31,
};

export const parseISO = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
export const toISO = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (iso: string, days: number): string => toISO(new Date(parseISO(iso).getTime() + days * DAY_MS));

export function formatDate(iso: string, today: string, relative = true): string {
  const d = parseISO(iso);
  const diff = Math.round((d.getTime() - parseISO(today).getTime()) / DAY_MS);
  if (relative && diff === 0) return "today";
  if (relative && diff === 1) return "tomorrow";
  const wd = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const md = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return diff > 0 && diff < 7 ? `${wd} ${md}` : md;
}

function endOfWeek(today: string): string {
  const dow = parseISO(today).getUTCDay(); // 0 = Sunday
  const toFriday = (5 - dow + 7) % 7;
  return addDays(today, toFriday);
}

function endOfQuarter(today: string): string {
  const d = parseISO(today);
  const q = Math.floor(d.getUTCMonth() / 3);
  const lastMonth = q * 3 + 2;
  return toISO(new Date(Date.UTC(d.getUTCFullYear(), lastMonth + 1, 0)));
}

function ordinalToDay(word: string): number | null {
  const m = /^(\d{1,2})(?:st|nd|rd|th)$/.exec(word);
  if (m) return Number(m[1]);
  return ORDINAL_WORDS[word] ?? null;
}

/** Deterministic parse of a named day/date in the utterance, relative to `today`. */
export function parseSpecificDate(text: string, today: string): string | null {
  const t = text.toLowerCase().replace(/[.,!?;]/g, " ");
  const todayD = parseISO(today);

  if (/\btomorrow\b/.test(t)) return addDays(today, 1);
  if (/\b(today|tonight|eod|end of (the )?day|after (this|standup)|right after)\b/.test(t)) return today;

  // "october 1st", "oct 1", "september thirtieth"
  const monthRe = new RegExp(`\\b(${MONTHS.map((m) => `${m}|${m.slice(0, 3)}`).join("|")})\\b\\s+(\\d{1,2}(?:st|nd|rd|th)?|[a-z-]+)`);
  const mm = monthRe.exec(t);
  if (mm) {
    const monthIdx = MONTHS.findIndex((m) => m === mm[1] || m.slice(0, 3) === mm[1]);
    const day = /^\d+/.test(mm[2]) ? Number.parseInt(mm[2], 10) : ordinalToDay(mm[2]);
    if (day && monthIdx >= 0) {
      let year = todayD.getUTCFullYear();
      if (monthIdx < todayD.getUTCMonth()) year++;
      return toISO(new Date(Date.UTC(year, monthIdx, day)));
    }
  }

  // "the 24th", "the thirtieth"
  const om = /\bthe\s+(\d{1,2}(?:st|nd|rd|th)|[a-z-]+teenth|[a-z-]+th|first|second|third)\b/.exec(t);
  if (om) {
    const day = ordinalToDay(om[1]);
    if (day) {
      let y = todayD.getUTCFullYear();
      let m = todayD.getUTCMonth();
      if (day < todayD.getUTCDate()) {
        m++;
        if (m > 11) {
          m = 0;
          y++;
        }
      }
      return toISO(new Date(Date.UTC(y, m, day)));
    }
  }

  // weekday names: next occurrence (today counts if it is that day)
  for (let i = 0; i < 7; i++) {
    if (new RegExp(`\\b${WEEKDAYS[i]}\\b`).test(t)) {
      const diff = (i - todayD.getUTCDay() + 7) % 7;
      return addDays(today, diff);
    }
  }
  return null;
}

/** Jev decides the *kind* of deadline; code turns it into a real date. */
export function resolveDeadline(kind: DeadlineKind, text: string, ctx: MeetingContext): ResolvedDeadline {
  switch (kind) {
    case "specific_date": {
      const date = parseSpecificDate(text, ctx.today);
      return { kind, date, label: date ? formatDate(date, ctx.today) : "date?" };
    }
    case "this_week": {
      const date = endOfWeek(ctx.today);
      return { kind, date, label: `this week · ${formatDate(date, ctx.today, false)}` };
    }
    case "next_sprint": {
      const date = addDays(ctx.sprintEnd, ctx.sprintDays);
      return { kind, date, label: `next sprint · ${formatDate(date, ctx.today)}` };
    }
    case "before_launch":
      return { kind, date: ctx.launch, label: `before launch · ${formatDate(ctx.launch, ctx.today)}` };
    case "end_of_quarter": {
      const date = endOfQuarter(ctx.today);
      return { kind, date, label: `EOQ · ${formatDate(date, ctx.today)}` };
    }
    default:
      return { kind: "none", date: null, label: "" };
  }
}
