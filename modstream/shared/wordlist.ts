/**
 * The "old way": a plain word list, the kind most chat bots ship with.
 * Deliberately realistic: case-insensitive substring match (the way most chat
 * bots do it), so it catches the obvious spelling and nothing else, and it
 * fires on innocent gamer chat that happens to contain a listed word
 * ("this boss is killing me", "free weekend", "my aim is trash").
 */
export const WORD_LIST: readonly string[] = [
  "kys",
  "kill yourself",
  "kill",
  "die",
  "trash",
  "idiot",
  "loser",
  "stupid",
  "retard",
  "fag",
  "nazi",
  "whore",
  "free",
  "giftcard",
  "gift card",
  "giveaway",
  "http",
  "discord.gg",
  "bit.ly",
  "crypto",
  "address",
  "dox",
  "vote",
  "trump",
  "biden",
  "election",
  "shut up",
];

/** Returns the first matched term or null. */
export function wordListMatch(text: string): string | null {
  const lower = text.toLowerCase();
  for (const term of WORD_LIST) {
    if (lower.includes(term)) return term;
  }
  return null;
}
