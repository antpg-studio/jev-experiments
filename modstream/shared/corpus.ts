import type { Truth } from "./types.ts";

/** mulberry32 — small seeded PRNG so every run is reproducible. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ADJ = [
  "silent", "neon", "turbo", "crispy", "sleepy", "pixel", "lucky", "salty", "cosmic", "rusty",
  "frosty", "mellow", "spicy", "quiet", "wobbly", "sneaky", "golden", "shadow", "hyper", "fuzzy",
  "chunky", "swift", "dizzy", "lunar", "grumpy", "velvet", "static", "sunny", "arctic", "toxic",
  "cyber", "retro", "mint", "iron", "wild", "tiny", "mega", "zesty", "gloomy", "witty",
];
const NOUN = [
  "otter", "falcon", "panda", "gamer", "wizard", "noodle", "raccoon", "viking", "ghost", "pirate",
  "badger", "goblin", "koala", "sniper", "toast", "walrus", "ninja", "llama", "moth", "cactus",
  "yeti", "penguin", "dragon", "hobbit", "wolf", "taco", "comet", "robot", "fox", "bean",
];
const COLORS = ["#ff7a90", "#7dd3fc", "#a7f3d0", "#fcd34d", "#c4b5fd", "#fdba74", "#f9a8d4", "#86efac", "#93c5fd", "#fde68a"];

export interface ChatUser {
  name: string;
  color: string;
}

export function makeUsers(count: number, rng: () => number): ChatUser[] {
  const seen = new Set<string>();
  const users: ChatUser[] = [];
  while (users.length < count) {
    const name = `${ADJ[Math.floor(rng() * ADJ.length)]}_${NOUN[Math.floor(rng() * NOUN.length)]}${Math.floor(rng() * 999)}`;
    if (seen.has(name)) continue;
    seen.add(name);
    users.push({ name, color: COLORS[Math.floor(rng() * COLORS.length)] });
  }
  return users;
}

// ---------------------------------------------------------------------------
// Corpus. Every template is labelled with ground truth so the HUD can compute
// catch rate and false positives for both the word list and Jev in real time.
// Normal chat deliberately includes word-list bait ("this boss is killing me",
// "free weekend", "my aim is trash") that a keyword filter blocks wrongly.
// ---------------------------------------------------------------------------

const NORMAL: readonly string[] = [
  "LETS GOOO that clutch was insane PogChamp",
  "what sens do you play on?",
  "GG that was clean",
  "W streamer",
  "first time here, this game looks fun",
  "KEKW",
  "that boss fight was mid ngl",
  "how long have you been running this game?",
  "the music in this zone slaps",
  "Pog Pog Pog",
  "is this the DLC or base game?",
  "my aim is trash today lol",
  "this boss is killing me every time i try it",
  "i died to that same jump like 40 times",
  "wait is there a free weekend on steam right now?",
  "lurking from work, dont tell my boss",
  "the pacing on this run is so good",
  "what a save omg",
  "chat is moving so fast today",
  "raid from the other stream, hello everyone!",
  "monkaS that health bar",
  "ez clap",
  "nooo the checkpoint 😭",
  "can you show the settings menu real quick?",
  "this is the best run ive seen all week",
  "LUL",
  "big brain play right there",
  "what's the world record for this category?",
  "hello from brazil 🇧🇷",
  "the vod from yesterday was amazing",
  "i keep dying on this level too, its brutal",
  "you have the patience of a saint for this game",
  "sheeeesh",
  "F in chat for that run",
  "the new patch nerfed that weapon right?",
  "wholesome stream tonight",
  "ok that skip was actually genius",
  "hyped for the marathon this weekend",
  "1v5 and still won, what",
  "gonna grab snacks, brb chat",
  "who else is watching at 3am",
  "the lighting in this cave section is gorgeous",
  "that dodge roll timing tho",
  "how do you keep so calm after dying that many times",
  "peepoHappy good vibes only",
  "did the run get reset or is that a save state?",
  "10/10 commentary",
  "the elevator music while loading is a vibe",
  "lmaooo the physics in this game",
  "that was a certified hood classic moment",
];

const BACKSEAT: readonly string[] = [
  "just use the shotgun bro, why do you keep picking the sniper",
  "you missed a chest back there, go back",
  "why didnt you heal there, you had 3 potions",
  "the skip is on the left, everyone knows that",
  "you should have parried instead of rolling",
  "wrong route, the faster one is through the sewer",
  "buy the upgrade already omg",
  "you keep forgetting to reload between fights",
];

const HARASSMENT: readonly string[] = [
  "you are the worst streamer on this whole site, quit already",
  "imagine being this bad at a kids game, embarrassing",
  "everyone in chat is laughing at you, nobody actually likes you",
  "@{u} shut up nobody asked for your opinion, clown",
  "@{u} you type like you have two brain cells",
  "your voice is so annoying i hope you lose your job",
  "trash streamer, trash chat, trash game",
  "nobody would notice if you never streamed again",
  "@{u} log off forever please, you ruin every stream",
  "how are you this dumb, genuinely",
];

const SLUR_EVASION: readonly string[] = [
  "k1ll yours3lf you trash streamer",
  "k y s lmao",
  "you're such a f4gg0t lol",
  "bunch of r3tards in this chat",
  "go d1e in a fire",
  "kys already n0body cares",
  "what a f@g",
  "this streamer is a r e t a r d",
  "k!ll urself streamer",
  "shut up f4g",
];

const SCAM: readonly string[] = [
  "Free 100$ steam giftcards, DM me on discord to claim before they run out",
  "streamer is giving away 50 nitro subs, check my bio for the link",
  "want free skins? add me and send me your login, i can dupe them",
  "🎁 GIVEAWAY 🎁 first 20 people to DM me get a free PS5",
  "I doubled my money on this coin in one week, dm me for the group invite",
  "get free vbucks here -> bit.ly/vb-free-2026",
  "streamer sent me here, everyone gets 2 months free if you click my profile",
  "selling this account cheap, pm me, paypal only",
  "join discord.gg/xyz-giveaways for free gift cards from the mods",
  "message me for free follower boosts, totally legit",
];

const DOXXING: readonly string[] = [
  "I live in the same town as you, I know your street. 4421 Maple",
  "i found your real name on linkedin, want me to post it?",
  "his phone number is 555-0134 if anyone wants to call and tell him he sucks",
  "@{u} i know which school you go to, careful what you say",
  "pretty sure the streamer's apartment is the one with the red door, i drove past it",
  "her mom works at the pharmacy on 3rd street, someone should pay a visit",
];

const SELF_HARM: readonly string[] = [
  "honestly i dont see the point anymore. nobody would care if i was gone",
  "this stream is the only thing keeping me going, i dont think ill be here next week",
  "i keep thinking about hurting myself again, sorry for being a downer chat",
  "not doing well lately. failed everything. dont know why i bother waking up",
  "sorry to dump this here but i just want it all to stop",
  "if i wasnt around anymore would anyone here even notice",
];

const SPAM: readonly string[] = [
  "GG GG GG GG GG GG GG GG GG GG GG GG GG GG GG",
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!",
  "PogChamp PogChamp PogChamp PogChamp PogChamp PogChamp PogChamp PogChamp",
  "LOOK AT ME LOOK AT ME LOOK AT ME LOOK AT ME LOOK AT ME LOOK AT ME",
  "ᕕ( ᐛ )ᕗ ᕕ( ᐛ )ᕗ ᕕ( ᐛ )ᕗ ᕕ( ᐛ )ᕗ ᕕ( ᐛ )ᕗ ᕕ( ᐛ )ᕗ ᕕ( ᐛ )ᕗ",
  "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
  "spam spam spam spam spam spam spam spam spam spam spam spam",
];

const OFF_TOPIC_FIGHT: readonly string[] = [
  "why are you not talking about the election, cowards, everyone here votes wrong anyway",
  "@{u} people like you are the reason this country is finished",
  "anyone who supports that party is a traitor, fight me",
  "stop gaming and talk about politics, your silence is a statement, coward",
  "@{u} typical, you people always cry when someone brings up the real issues",
  "this chat is full of brainwashed sheep, wake up",
];

export const BUCKETS: ReadonlyArray<{ truth: Truth; weight: number; lines: readonly string[] }> = [
  { truth: "ok", weight: 74, lines: NORMAL },
  { truth: "backseat", weight: 6, lines: BACKSEAT },
  { truth: "harassment", weight: 5, lines: HARASSMENT },
  { truth: "slur_evasion", weight: 3, lines: SLUR_EVASION },
  { truth: "scam", weight: 4, lines: SCAM },
  { truth: "doxxing", weight: 1.5, lines: DOXXING },
  { truth: "self_harm", weight: 1.5, lines: SELF_HARM },
  { truth: "spam", weight: 3, lines: SPAM },
  { truth: "off_topic_fight", weight: 2, lines: OFF_TOPIC_FIGHT },
];

export const RAID_BUCKETS: ReadonlyArray<{ truth: Truth; weight: number; lines: readonly string[] }> = [
  { truth: "spam", weight: 55, lines: SPAM },
  { truth: "harassment", weight: 25, lines: HARASSMENT },
  { truth: "slur_evasion", weight: 15, lines: SLUR_EVASION },
  { truth: "scam", weight: 5, lines: SCAM },
];

export interface GeneratedLine {
  text: string;
  truth: Truth;
}

function pickWeighted<T extends { weight: number }>(items: readonly T[], rng: () => number): T {
  const total = items.reduce((s, b) => s + b.weight, 0);
  let r = rng() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

export function generateLine(
  rng: () => number,
  users: readonly ChatUser[],
  buckets: typeof BUCKETS = BUCKETS,
): GeneratedLine {
  const bucket = pickWeighted(buckets, rng);
  let text = bucket.lines[Math.floor(rng() * bucket.lines.length)];
  if (text.includes("{u}")) {
    text = text.replace("{u}", users[Math.floor(rng() * users.length)].name);
  }
  return { text, truth: bucket.truth };
}

/** Full fixture: every labelled line once, for offline evaluation and tests. */
export function allFixtureLines(): GeneratedLine[] {
  const out: GeneratedLine[] = [];
  for (const b of BUCKETS) for (const text of b.lines) out.push({ text: text.replace("{u}", "pixel_otter42"), truth: b.truth });
  return out;
}
